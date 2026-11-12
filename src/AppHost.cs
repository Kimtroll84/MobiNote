using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MobiNote {
 internal sealed class NativeError:Exception {
  internal string Code,Command;
  internal NativeError(string message,string code,string command=null):base(message){Code=code;Command=command;}
 }
 internal sealed class AgentForm:Form {
  internal bool AllowClose,Running;internal Action CloseRequested;
  protected override bool ShowWithoutActivation{get{return true;}}
  internal AgentForm(){
   FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;StartPosition=FormStartPosition.Manual;
   BackColor=ColorTranslator.FromHtml("#f7faef");ClientSize=new Size(600,230);Text="작업 에이전트";
   Resize+=(sender,e)=>RoundCorners();
   FormClosing+=(sender,e)=>{if(!AllowClose){e.Cancel=true;if(!Running&&CloseRequested!=null)CloseRequested();}};
   VisibleChanged+=(sender,e)=>{if(!Visible&&Running&&!AllowClose&&!IsDisposed)BeginInvoke((Action)(()=>{if(Running&&!AllowClose&&!IsDisposed)Show();}));};
   RoundCorners();
  }
  private void RoundCorners(){
   using(var shape=new GraphicsPath()){
    float r=32;shape.AddArc(0,0,r,r,180,90);shape.AddArc(Width-r,0,r,r,270,90);shape.AddArc(Width-r,Height-r,r,r,0,90);shape.AddArc(0,Height-r,r,r,90,90);shape.CloseFigure();
    var previous=Region;Region=new Region(shape);if(previous!=null)previous.Dispose();
   }
  }
 }
 internal sealed class AppHost:Form {
  private readonly string root,settingsFile;
  private readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=32*1024*1024,RecursionLimit=1000};
  private readonly WebView2 mainView=new WebView2();
  private readonly HashSet<string> reads=new HashSet<string>{"status","capabilities","get_gatherable_items","get_craftable_items","get_alterable_items","get_altering_works","get_items","get_my_info","get_activity","get_currencies"};
  private readonly HashSet<string> actions=new HashSet<string>{"execute_gathering","execute_crafting","execute_altering","complete_altering_work","stop_action"};
  private readonly Dictionary<long,TaskCompletionSource<object>> agentRequests=new Dictionary<long,TaskCompletionSource<object>>();
  private CoreWebView2Environment environment;private AgentForm agent;private WebView2 agentView;
  private Form picker;private WebView2 pickerView;private object pickerData;private Task pickerOpening;private bool pickerAllowClose;
  private readonly Timer pickerPositionTimer=new Timer{Interval=150};
  private readonly Dictionary<long,TaskCompletionSource<object>> pickerRequests=new Dictionary<long,TaskCompletionSource<object>>();
  private object currentState;private Dictionary<string,object> preferences,appInfo;
  private bool running,ready,allowClose,closing,rendererFailed;private long agentSequence;
  private readonly string traceSession=Guid.NewGuid().ToString("N");private long traceSequence;
  private readonly Stopwatch traceClock=Stopwatch.StartNew();private readonly List<string> traceBuffer=new List<string>();
  private readonly Timer traceTimer=new Timer{Interval=1000};private Task traceWrite=Task.FromResult(0);
  private void Trace(string eventName,object detail){
   if(preferences==null||!BoolValue(preferences,"agentTraceEnabled"))return;
   try{var row=new{schema=1,session=traceSession,seq=++traceSequence,at=DateTime.UtcNow.ToString("o"),appMs=traceClock.Elapsed.TotalMilliseconds,@event=eventName,detail=detail};traceBuffer.Add(json.Serialize(row));if(traceBuffer.Count>=200)FlushTrace();}catch{}
  }
  private void FlushTrace(){
   if(traceBuffer.Count==0)return;string text=String.Join(Environment.NewLine,traceBuffer.ToArray())+Environment.NewLine;traceBuffer.Clear();string file=Path.Combine(root,"agent-trace-"+DateTime.Now.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture)+".jsonl");
   traceWrite=traceWrite.ContinueWith(previous=>{try{File.AppendAllText(file,text,new UTF8Encoding(false));}catch{}},TaskScheduler.Default);
  }
  private void ReceiveTrace(object value){
   if(preferences==null||!BoolValue(preferences,"agentTraceEnabled"))return;
   var rows=value as System.Collections.IEnumerable;if(rows==null)return;int count=0;
   foreach(var entry in rows){if(++count>100)break;var row=Dict(entry);string name=TextValue(row,"event");if(name!="engine-stage"&&!name.StartsWith("agent-",StringComparison.Ordinal))continue;string encoded=json.Serialize(row);if(encoded.Length<=16000)Trace("renderer",row);}
  }

  private readonly Timer positionTimer=new Timer{Interval=150};
  [DllImport("user32.dll")]private static extern bool ReleaseCapture();
  [DllImport("user32.dll")]private static extern IntPtr SendMessage(IntPtr hwnd,int msg,IntPtr wparam,IntPtr lparam);
  internal AppHost(string folder){
   root=folder;settingsFile=Path.Combine(root,"settings.json");Directory.CreateDirectory(Path.Combine(root,"user"));
   Text="모비노트 0.9.10";StartPosition=FormStartPosition.CenterScreen;ClientSize=new Size(920,920);
   MinimumSize=new Size(Width,640);MaximumSize=new Size(Width,65535);MaximizeBox=false;AutoScaleMode=AutoScaleMode.Dpi;BackColor=ColorTranslator.FromHtml("#f6f9f1");
   Icon=new Icon(Path.Combine(root,"content/ui/assets/MobiNote_A.ico"));mainView.Dock=DockStyle.Fill;Controls.Add(mainView);
   positionTimer.Tick+=(sender,e)=>{positionTimer.Stop();if(agent!=null&&!agent.IsDisposed&&agent.Visible)Post(mainView,"agent-position",new{x=agent.Left,y=agent.Top});};
   traceTimer.Tick+=(sender,e)=>FlushTrace();traceTimer.Start();
   pickerPositionTimer.Tick+=(sender,e)=>{pickerPositionTimer.Stop();SavePickerPosition();};
   FormClosing+=OnClosing;FormClosed+=(sender,e)=>{closing=true;DestroyPicker();DestroyAgent();positionTimer.Dispose();pickerPositionTimer.Dispose();mainView.Dispose();Trace("session-end",new{});traceTimer.Stop();traceTimer.Dispose();FlushTrace();try{traceWrite.Wait(1500);}catch{};};Shown+=async(sender,e)=>await Initialize();
  }
  private async Task Initialize(){
   try{
    string runtimeVersion=CoreWebView2Environment.GetAvailableBrowserVersionString();
    var options=new CoreWebView2EnvironmentOptions();options.AdditionalBrowserArguments="--disable-background-timer-throttling --disable-renderer-backgrounding";
    int debugPort;if(Int32.TryParse(Environment.GetEnvironmentVariable("MOBINOTE_DEBUG_PORT"),out debugPort)&&debugPort>1024&&debugPort<65536)options.AdditionalBrowserArguments+=" --remote-debugging-address=127.0.0.1 --remote-debugging-port="+debugPort;
    environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(root,"user"),options);
    preferences=File.Exists(settingsFile)?Parse(File.ReadAllText(settingsFile,Encoding.UTF8)):new Dictionary<string,object>();
    appInfo=Parse(File.ReadAllText(Path.Combine(root,"content/app-info.json"),Encoding.UTF8));appInfo["runtime"]="C# + WebView2";appInfo["webView2Version"]=runtimeVersion;Trace("session-start",new{version=Value(appInfo,"version"),purpose="agent-dialogue-recording"});
    await Configure(mainView,false);mainView.CoreWebView2.NavigationCompleted+=async(sender,e)=>{if(e.IsSuccess){await NormalizeSize(this,mainView,920,920,true);CenterToScreen();ready=true;}};mainView.CoreWebView2.Navigate("https://mobinote.example/ui/index.html");
   }catch(Exception error){Log("errors.log",new{eventName="startup",message=error.ToString()});MessageBox.Show(this,"앱을 시작하지 못했어요.\nMicrosoft Edge WebView2 Runtime과 .NET Framework 4.8이 필요해요.\n\n"+error.Message,"모비노트",MessageBoxButtons.OK,MessageBoxIcon.Error);allowClose=true;Close();}
  }
  private async Task Configure(WebView2 view,bool popup,string role=null){
   view.DefaultBackgroundColor=popup?Color.Transparent:Color.White;await view.EnsureCoreWebView2Async(environment);var core=view.CoreWebView2;
   core.SetVirtualHostNameToFolderMapping("mobinote.example",Path.Combine(root,"content"),CoreWebView2HostResourceAccessKind.DenyCors);
   core.Settings.AreDefaultContextMenusEnabled=false;core.Settings.AreDevToolsEnabled=false;core.Settings.AreBrowserAcceleratorKeysEnabled=false;core.Settings.IsStatusBarEnabled=false;core.Settings.IsZoomControlEnabled=false;core.Settings.IsGeneralAutofillEnabled=false;core.Settings.IsPasswordAutosaveEnabled=false;
   core.PermissionRequested+=(sender,e)=>e.State=CoreWebView2PermissionState.Deny;core.NewWindowRequested+=(sender,e)=>e.Handled=true;core.DownloadStarting+=(sender,e)=>e.Cancel=true;
   core.NavigationStarting+=(sender,e)=>{if(!e.Uri.StartsWith("https://mobinote.example/",StringComparison.Ordinal))e.Cancel=true;};
   core.WebMessageReceived+=async(sender,e)=>{
    Dictionary<string,object> request=null;
    try{
     string expected="https://mobinote.example/ui/"+(role=="picker"?"picker.html":popup?"progress.html":"index.html");if(e.Source!=expected)throw new Exception("허용되지 않은 페이지 요청이에요.");
     request=Parse(e.WebMessageAsJson);string method=TextValue(request,"method");if(role=="picker"&&method!="picker-request"&&method!="hide-picker")throw new Exception("허용되지 않은 가공품 선택창 요청이에요.");if(popup&&role!="picker"&&method!="agent-request"&&method!="drag-agent")throw new Exception("허용되지 않은 작업 에이전트 요청이에요.");
     object result=await Dispatch(method,Dict(Value(request,"body")),popup);Reply(view,Value(request,"id"),true,result,null);
    }catch(Exception error){var nativeError=error as NativeError;Reply(view,request==null?null:Value(request,"id"),false,null,new{message=error.Message,code=nativeError==null?null:nativeError.Code,command=nativeError==null?null:nativeError.Command});}
   };
   core.ProcessFailed+=async(sender,e)=>{
    if(closing||allowClose)return;
    string kind=e.ProcessFailedKind.ToString();Log("errors.log",new{@event="webview-process-failed",kind=kind});
    if(!popup&&(kind=="RenderProcessExited"||kind=="BrowserProcessExited")){
     rendererFailed=true;ready=false;
     if(running){
      try{await RunCli(new Dictionary<string,object>{{"file",TextValue(preferences,"cliPath")},{"command","stop_action"}});Log("diagnostics.log",new{@event="renderer-failure-stop",result="requested"});}
      catch(Exception error){Log("errors.log",new{@event="renderer-failure-stop",message=error.Message});}
      running=false;if(agent!=null)agent.Running=false;
     }
     MessageBox.Show(this,"작업 화면이 종료됐어요. 앱을 다시 실행하고 게임의 작업 상태를 확인해 주세요.","모비노트",MessageBoxButtons.OK,MessageBoxIcon.Warning);
    }
   };
  }
  private void OnClosing(object sender,FormClosingEventArgs e){
   if(allowClose||!ready)return;e.Cancel=true;
   if(running){if(MessageBox.Show(this,"실행을 중단할까요? 중단한 뒤 창을 닫아 주세요.","모비노트",MessageBoxButtons.YesNo,MessageBoxIcon.Question,MessageBoxDefaultButton.Button2)==DialogResult.Yes)Post(mainView,"stop-request",null);}
   else Post(mainView,"close-request",null);
  }
  private async Task<object> Dispatch(string method,Dictionary<string,object> body,bool popup){
   switch(method){
    case "startup":return new{preferences=preferences,appInfo=appInfo};
    case "window-metrics":return new{clientWidth=ClientSize.Width,clientHeight=ClientSize.Height,viewWidth=mainView.Width,viewHeight=mainView.Height,dpi=DeviceDpi,visible=Visible,ready=ready,agent=agent==null?null:(object)new{x=agent.Left,y=agent.Top,width=agent.Width,height=agent.Height},main=new{x=Left,y=Top,width=Width,height=Height},picker=picker==null?null:(object)new{x=picker.Left,y=picker.Top,width=picker.Width,height=picker.Height,visible=picker.Visible,topMost=picker.TopMost,owned=picker.Owner==this}};
    case "capture-main":
     if(String.IsNullOrEmpty(Environment.GetEnvironmentVariable("MOBINOTE_DEBUG_PORT")))throw new Exception("진단 모드에서만 사용할 수 있어요.");
     Show();WindowState=FormWindowState.Normal;BringToFront();Activate();mainView.Visible=true;mainView.Focus();await Task.Delay(500);
     string screenshot=Path.Combine(root,"webview-preview.png");
     using(var stream=File.Create(screenshot))await mainView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,stream);
     return screenshot;
    case "capture-agent":
     if(String.IsNullOrEmpty(Environment.GetEnvironmentVariable("MOBINOTE_DEBUG_PORT"))||agentView==null)throw new Exception("표시 중인 에이전트 진단 창이 없어요.");
     string agentShot=Path.Combine(root,"agent-preview.png");
     using(var stream=File.Create(agentShot))await agentView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,stream);
     return agentShot;
    case "show-picker":
     if(running)throw new Exception("작업 중에는 가공품을 선택할 수 없어요.");pickerData=Value(body,"data");
     if(pickerOpening==null)pickerOpening=EnsurePicker();try{await pickerOpening;}finally{pickerOpening=null;}
     if(!closing&&picker!=null&&!picker.IsDisposed){if(!picker.Visible)picker.Show(this);picker.BringToFront();Post(pickerView,"picker-state",pickerData);Post(mainView,"picker-visible",true);}return null;
    case "update-picker":pickerData=Value(body,"data");if(picker!=null&&!picker.IsDisposed&&picker.Visible)Post(pickerView,"picker-state",pickerData);return null;
    case "hide-picker":HidePicker();return null;
    case "picker-response":
     long pickerId=Convert.ToInt64(Value(body,"id"));TaskCompletionSource<object> pickerCompletion;
     if(pickerRequests.TryGetValue(pickerId,out pickerCompletion)){pickerRequests.Remove(pickerId);if(BoolValue(body,"ok"))pickerCompletion.TrySetResult(Value(body,"data"));else pickerCompletion.TrySetException(new Exception(TextValue(body,"error")));}return null;
    case "picker-request":
     string pickerCommand=TextValue(body,"command");if(pickerCommand=="bootstrap")return pickerData;
     if(pickerCommand!="select"&&pickerCommand!="facility")throw new Exception("허용되지 않은 선택창 명령이에요.");
     if(running)throw new Exception("작업 중에는 선택을 바꿀 수 없어요.");
     long pickerRequestId=++agentSequence;var pickerResponse=new TaskCompletionSource<object>();pickerRequests[pickerRequestId]=pickerResponse;
     Post(mainView,"picker-call",new{id=pickerRequestId,command=pickerCommand,value=Value(body,"value")});return await pickerResponse.Task;
    case "validate-cli":ValidateCli(TextValue(body,"file"));return null;
    case "cli":return await RunCli(body);
    case "publish-state":UpdateState(Value(body,"state"));return null;
    case "persist-state":preferences=Dict(Value(body,"persistent"));if(!BoolValue(preferences,"agentTraceEnabled"))traceBuffer.Clear();SaveSettings(preferences);UpdateState(Value(body,"state"));return null;
    case "trace-events":ReceiveTrace(Value(body,"events"));return null;
    case "diagnostic":Log("diagnostics.log",body);return null;
    case "error-log":Log("errors.log",body);return null;
    case "choose-cli":
     if(running)throw new Exception("작업을 마친 뒤 설정해 주세요.");
     using(var select=new OpenFileDialog{Filter="공식 CLI|MabinogiMobile_CLI.exe",Title="공식 게임 CLI 선택",CheckFileExists=true})return select.ShowDialog(this)==DialogResult.OK?select.FileName:null;
    case "show-agent":UpdateState(Value(body,"state"));if(BoolValue(body,"embedded")){DestroyAgent();return null;}await ShowAgent(body);return null;
    case "hide-agent":if(!running)DestroyAgent();return null;
    case "agent-visible":return agent!=null&&!agent.IsDisposed&&agent.Visible;
    case "agent-result":if(agentView!=null)Post(agentView,"result",Value(body,"result"));return null;
    case "agent-response":
     long id=Convert.ToInt64(Value(body,"id"));TaskCompletionSource<object> completion;
     if(agentRequests.TryGetValue(id,out completion)){agentRequests.Remove(id);if(BoolValue(body,"ok"))completion.TrySetResult(Value(body,"data"));else completion.TrySetException(new Exception(TextValue(body,"error")));}return null;
    case "agent-request":
     string command=TextValue(body,"command");if(command=="agent-trace"){var traceArgs=Value(body,"args") as System.Collections.IList;if(traceArgs!=null&&traceArgs.Count>0)ReceiveTrace(traceArgs[0]);return null;}if(command=="bootstrap")return new{state=currentState,smoke=false};
     if(command!="stop"&&command!="hide-progress")throw new Exception("허용되지 않은 작업 에이전트 요청이에요.");
     long requestId=++agentSequence;var response=new TaskCompletionSource<object>();agentRequests[requestId]=response;Post(mainView,"agent-call",new{id=requestId,command=command,args=Value(body,"args")});return await response.Task;
    case "drag-agent":if(popup&&agent!=null){ReleaseCapture();SendMessage(agent.Handle,0xA1,new IntPtr(2),IntPtr.Zero);}return null;
    case "export-data":
     if(running)throw new Exception("작업을 마친 뒤 내보내 주세요.");
     using(var save=new SaveFileDialog{Filter="모비노트 데이터|*.json",DefaultExt="json",FileName="MobiNote-backup-"+DateTime.Now.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture)+".json",Title="즐겨찾기·작업 프리셋 내보내기"}){if(save.ShowDialog(this)!=DialogResult.OK)return false;File.WriteAllText(save.FileName,json.Serialize(Value(body,"backup")),new UTF8Encoding(false));return true;}
    case "import-data":
     if(running)throw new Exception("작업을 마친 뒤 불러와 주세요.");
     using(var select=new OpenFileDialog{Filter="모비노트 데이터|*.json",Title="즐겨찾기·작업 프리셋 불러오기",CheckFileExists=true})return select.ShowDialog(this)==DialogResult.OK?File.ReadAllText(select.FileName,Encoding.UTF8):null;
    case "confirm-import":return MessageBox.Show(this,"즐겨찾기 "+Value(body,"favorites")+"개와 작업 프리셋 "+Value(body,"presets")+"개로 교체할까요?\n현재 대기줄과 앱 설정은 유지해요.","데이터 불러오기",MessageBoxButtons.YesNo,MessageBoxIcon.Question,MessageBoxDefaultButton.Button2)==DialogResult.Yes;
    case "backup-settings":if(File.Exists(settingsFile))File.Copy(settingsFile,settingsFile+".before-import.json",true);return null;
    case "close-app":if(running)throw new Exception("작업을 중단한 뒤 닫아 주세요.");allowClose=true;DestroyAgent();BeginInvoke((Action)(()=>Close()));return null;
    default:throw new Exception("지원하지 않는 네이티브 요청이에요.");
   }
  }
  private async Task EnsurePicker(){
   if(picker!=null&&!picker.IsDisposed)return;
   var window=new Form{Text="가공품 선택",FormBorderStyle=FormBorderStyle.FixedSingle,MaximizeBox=false,MinimizeBox=false,BackColor=Color.FromArgb(245,248,239),ShowInTaskbar=false,StartPosition=FormStartPosition.Manual,ClientSize=new Size(410,430),TopMost=false,Icon=Icon};
   var view=new WebView2{Dock=DockStyle.Fill};window.Controls.Add(view);picker=window;pickerView=view;
   var saved=Dict(Value(preferences,"pickerPosition"));Point initial=new Point(Right+12,Top+110);
   if(saved.ContainsKey("x")&&saved.ContainsKey("y")){try{initial=new Point(Convert.ToInt32(saved["x"]),Convert.ToInt32(saved["y"]));}catch{}}
   Rectangle area=Screen.FromPoint(initial).WorkingArea;
   window.Location=new Point(Math.Max(area.Left,Math.Min(initial.X,area.Right-window.Width)),Math.Max(area.Top,Math.Min(initial.Y,area.Bottom-window.Height)));
   window.LocationChanged+=(sender,e)=>{if(window.Visible){pickerPositionTimer.Stop();pickerPositionTimer.Start();}};
   window.FormClosing+=(sender,e)=>{if(!pickerAllowClose&&!closing&&!allowClose&&e.CloseReason!=CloseReason.FormOwnerClosing){e.Cancel=true;HidePicker();}};
   try{
    var handle=window.Handle;await Configure(view,true,"picker");var loaded=new TaskCompletionSource<bool>();EventHandler<CoreWebView2NavigationCompletedEventArgs> completed=null;
    completed=(sender,e)=>{view.CoreWebView2.NavigationCompleted-=completed;loaded.TrySetResult(e.IsSuccess);};view.CoreWebView2.NavigationCompleted+=completed;view.CoreWebView2.Navigate("https://mobinote.example/ui/picker.html");
    if(!await loaded.Task)throw new Exception("가공품 선택창을 불러오지 못했어요.");
    await NormalizeSize(window,view,410,430,false);
   }catch{DestroyPicker();throw;}
  }
  private void SavePickerPosition(){
   if(picker==null||picker.IsDisposed||preferences==null)return;
   preferences["pickerPosition"]=new Dictionary<string,object>{{"x",picker.Left},{"y",picker.Top}};SaveSettings(preferences);if(!closing)Post(mainView,"picker-position",preferences["pickerPosition"]);
  }
  private void HidePicker(){pickerPositionTimer.Stop();if(picker!=null&&!picker.IsDisposed&&picker.Visible){SavePickerPosition();picker.Hide();}if(!closing)Post(mainView,"picker-visible",false);}
  private void DestroyPicker(){pickerPositionTimer.Stop();if(picker!=null&&!picker.IsDisposed){SavePickerPosition();pickerAllowClose=true;var old=picker;picker=null;pickerView=null;old.Close();old.Dispose();pickerAllowClose=false;}foreach(var pending in pickerRequests.Values)pending.TrySetException(new Exception("선택창이 종료됐어요."));pickerRequests.Clear();}
  private async Task ShowAgent(Dictionary<string,object> options){
   if(agent==null||agent.IsDisposed){
    var window=new AgentForm();var view=new WebView2{Dock=DockStyle.Fill};window.Controls.Add(view);agent=window;agentView=view;window.Running=running;window.Icon=Icon;window.TopMost=BoolValue(options,"onTop");
    window.CloseRequested=()=>{if(!running){DestroyAgent();Post(mainView,"agent-visible",false);}};
    window.LocationChanged+=(sender,e)=>{if(window.Visible){positionTimer.Stop();positionTimer.Start();}};
    var saved=Dict(Value(options,"position"));Point initial=saved.ContainsKey("x")&&saved.ContainsKey("y")?new Point(Convert.ToInt32(saved["x"]),Convert.ToInt32(saved["y"])):new Point(Left+(Width-600)/2,Top+(Height-230)/2);
    Rectangle area=Screen.FromPoint(initial).WorkingArea;window.Location=new Point(Math.Max(area.Left,Math.Min(initial.X,area.Right-600)),Math.Max(area.Top,Math.Min(initial.Y,area.Bottom-230)));
    var handle=window.Handle;await Configure(view,true);var loaded=new TaskCompletionSource<bool>();EventHandler<CoreWebView2NavigationCompletedEventArgs> completed=null;
    completed=(sender,e)=>{view.CoreWebView2.NavigationCompleted-=completed;loaded.TrySetResult(e.IsSuccess);};view.CoreWebView2.NavigationCompleted+=completed;view.CoreWebView2.Navigate("https://mobinote.example/ui/progress.html");
    if(!await loaded.Task)throw new Exception("작업 에이전트 화면을 불러오지 못했어요.");if(closing||agent!=window)return;window.Show();Trace("agent-window",new{visible=true,mode="separate"});await NormalizeSize(window,view,600,230,false);await FocusAgentCanvas(view);Post(view,"state",currentState);
   }else{agent.TopMost=BoolValue(options,"onTop");agent.Running=running;if(!agent.Visible)agent.Show();Trace("agent-window",new{visible=true,mode="separate"});await FocusAgentCanvas(agentView);Post(agentView,"state",currentState);}
  }
  private async Task FocusAgentCanvas(WebView2 view){if(view==null||view.IsDisposed||view.CoreWebView2==null)return;await view.CoreWebView2.ExecuteScriptAsync("(()=>{const main=document.querySelector('main');if(main){main.tabIndex=-1;main.focus({preventScroll:true});}})()");}
  private void UpdateState(object state){if(state==null)return;currentState=state;running=BoolValue(Dict(state),"running");if(running)HidePicker();if(agent!=null&&!agent.IsDisposed){agent.Running=running;Post(agentView,"state",state);}}
  private async Task NormalizeSize(Form form,WebView2 view,int width,int height,bool resizeHeight){
   try{
    for(int i=0;i<2;i++){
     await Task.Delay(80);string text=await view.CoreWebView2.ExecuteScriptAsync("JSON.stringify({width:innerWidth,height:innerHeight})");
     var dimensions=Parse(json.Deserialize<string>(text));double w=Convert.ToDouble(Value(dimensions,"width")),h=Convert.ToDouble(Value(dimensions,"height"));
     if(w<=0||h<=0)return;double scaleX=view.ClientSize.Width/w,scaleY=view.ClientSize.Height/h;
     form.MinimumSize=Size.Empty;form.MaximumSize=Size.Empty;form.ClientSize=new Size((int)Math.Round(width*scaleX),(int)Math.Round(height*scaleY));
     if(resizeHeight){int border=form.Height-form.ClientSize.Height;form.MinimumSize=new Size(form.Width,(int)Math.Round(640*scaleY)+border);form.MaximumSize=new Size(form.Width,65535);}
    }
   }catch(Exception error){Log("diagnostics.log",new{@event="window-size-check",message=error.Message});}
  }
  private void DestroyAgent(){if(agent!=null&&!agent.IsDisposed)Trace("agent-window",new{visible=false,mode="separate"});positionTimer.Stop();if(agent!=null&&!agent.IsDisposed){var old=agent;agent=null;agentView=null;try{preferences["agentPosition"]=new Dictionary<string,object>{{"x",old.Left},{"y",old.Top}};SaveSettings(preferences);Post(mainView,"agent-position",preferences["agentPosition"]);}catch(Exception error){Log("diagnostics.log",new{@event="agent-position-save",message=error.Message});}old.AllowClose=true;old.Close();old.Dispose();}}
  private void SaveSettings(object value){string next=settingsFile+".next";File.WriteAllText(next,json.Serialize(value),new UTF8Encoding(false));if(File.Exists(settingsFile))File.Replace(next,settingsFile,null);else File.Move(next,settingsFile);}
  private void Log(string filename,object value){var row=value as Dictionary<string,object>??Parse(json.Serialize(value));row["at"]=DateTime.UtcNow.ToString("o");File.AppendAllText(Path.Combine(root,filename),json.Serialize(row)+Environment.NewLine,new UTF8Encoding(false));}
  private void Post(WebView2 view,string channel,object value){if(!closing&&!(rendererFailed&&view==mainView)&&view!=null&&!view.IsDisposed&&view.CoreWebView2!=null)view.CoreWebView2.PostWebMessageAsJson(json.Serialize(new{@event=channel,data=value}));}
  private void Reply(WebView2 view,object id,bool ok,object data,object error){if(!closing&&!(rendererFailed&&view==mainView)&&view!=null&&!view.IsDisposed&&view.CoreWebView2!=null)view.CoreWebView2.PostWebMessageAsJson(json.Serialize(new{reply=id,ok=ok,data=data,error=error}));}
  private Dictionary<string,object> Parse(string value){return json.Deserialize<Dictionary<string,object>>(value);}
  private static Dictionary<string,object> Dict(object value){return value as Dictionary<string,object>??new Dictionary<string,object>();}
  private static object Value(Dictionary<string,object> data,string key){object value;return data!=null&&data.TryGetValue(key,out value)?value:null;}
  private static string TextValue(Dictionary<string,object> data,string key){return Convert.ToString(Value(data,key),CultureInfo.InvariantCulture)??"";}
  private static bool BoolValue(Dictionary<string,object> data,string key){return Value(data,key) is bool&&(bool)Value(data,key);}
  private static void ValidateCli(string file){if(!Path.IsPathRooted(file)||!String.Equals(Path.GetFileName(file),"MabinogiMobile_CLI.exe",StringComparison.OrdinalIgnoreCase)||!File.Exists(file))throw new NativeError("공식 CLI 파일을 선택해 주세요.","invalid_cli");}
  private async Task<string> ReadOutput(StreamReader reader){var text=new StringBuilder();var buffer=new char[8192];int count;while((count=await reader.ReadAsync(buffer,0,buffer.Length))>0){text.Append(buffer,0,count);if(text.Length>16000000)throw new NativeError("CLI 응답이 너무 큽니다.","response_too_large");}return text.ToString();}
  private async Task<object> RunCli(Dictionary<string,object> body){
   long id=++agentSequence;string command=TextValue(body,"command");var argument=Dict(Value(body,"body"));var watch=Stopwatch.StartNew();
   Trace("cli-request",new{id=id,command=command,item=TextValue(argument,"displayName"),craftCount=Value(argument,"craftCount")});
   try{var result=await RunCliCore(body);Trace("cli-response",new{id=id,command=command,elapsedMs=watch.Elapsed.TotalMilliseconds,exitCode=result.GetType().GetProperty("exitCode").GetValue(result,null)});return result;}
   catch(Exception error){Trace("cli-response",new{id=id,command=command,elapsedMs=watch.Elapsed.TotalMilliseconds,failed=true,errorType=error.GetType().Name});throw;}
  }
  private async Task<object> RunCliCore(Dictionary<string,object> body){
   string command=TextValue(body,"command"),file=TextValue(body,"file");if(!reads.Contains(command)&&!actions.Contains(command))throw new NativeError("지원하지 않는 CLI 명령이에요.","invalid_command",command);ValidateCli(file);
   object argument=Value(body,"body");string arguments=command;if(argument!=null)arguments+=" base64:"+Convert.ToBase64String(Encoding.UTF8.GetBytes(argument is string?(string)argument:json.Serialize(argument)));
   using(var process=new Process()){
    process.StartInfo=new ProcessStartInfo{FileName=file,Arguments=arguments,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};process.EnableRaisingEvents=true;
    var exit=new TaskCompletionSource<bool>();process.Exited+=(sender,e)=>exit.TrySetResult(true);
    try{
     process.Start();var stdout=ReadOutput(process.StandardOutput);var stderr=ReadOutput(process.StandardError);int timeout=actions.Contains(command)&&command!="stop_action"?600000:15000;
     Task deadline=Task.Delay(timeout);Task ended=await Task.WhenAny(exit.Task,deadline,stdout);if(ended==stdout&&stdout.IsFaulted){process.Kill();await stdout;}
     if(!exit.Task.IsCompleted){if(ended==stdout)ended=await Task.WhenAny(exit.Task,deadline);if(!exit.Task.IsCompleted){try{process.Kill();}catch{}throw new NativeError("게임 응답 시간이 초과됐어요.","timeout",command);}}
     string raw=await stdout;await stderr;if(command=="execute_crafting")Log("diagnostics.log",new{@event="craft-cli-response",command=command,request=argument,exitCode=process.ExitCode,rawResponse=raw});return new{raw=raw,exitCode=process.ExitCode};
    }catch(NativeError error){if(error.Command==null)error.Command=command;throw;}catch(Exception error){throw new NativeError(error.Message,"cli_process_error",command);}
   }
  }
 }
}
