using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
[assembly: AssemblyTitle("MobiNote WebView2")]
[assembly: AssemblyProduct("MobiNote")]
[assembly: AssemblyCompany("Troll_Kim")]
[assembly: AssemblyCopyright("Copyright (c) 2026 Troll_Kim")]
[assembly: AssemblyVersion("0.9.7.0")]
[assembly: AssemblyFileVersion("0.9.7.0")]
namespace MobiNote {
 internal static class Program {
  [STAThread] private static void Main() {
   string root=AppDomain.CurrentDomain.BaseDirectory,identity;
   using(var sha=SHA256.Create())identity=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToUpperInvariant()))).Replace("-","");
   bool first;using(var mutex=new Mutex(true,"Local\\MobiNote-WebView2-"+identity,out first)){
    if(!first){MessageBox.Show("이 폴더의 모비노트가 이미 실행 중이에요.","모비노트");return;}
    Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
    Application.ThreadException+=(sender,e)=>{try{File.AppendAllText(Path.Combine(root,"errors.log"),DateTime.UtcNow.ToString("o")+" "+e.Exception+Environment.NewLine);}catch{}};
    try{Application.Run(new AppHost(root));}catch(Exception error){MessageBox.Show("앱을 시작하지 못했어요.\n"+error.Message,"모비노트",MessageBoxButtons.OK,MessageBoxIcon.Error);}
   }
  }
 }
}
