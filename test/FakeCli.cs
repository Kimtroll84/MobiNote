// Test executable only: never copied into the application or used against the game.
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
class FakeCli {
 static JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=32*1024*1024,RecursionLimit=1000};
 static Dictionary<string,object> Dict(object value){return value as Dictionary<string,object>;}
 static object Get(Dictionary<string,object> value,string key){return value.ContainsKey(key)?value[key]:null;}
 static string Text(Dictionary<string,object> value,string key){return Convert.ToString(Get(value,key));}
 static IEnumerable<Dictionary<string,object>> Rows(object value){return ((IEnumerable)value).Cast<object>().Select(Dict);}
 static void Main(string[] args){
  Console.OutputEncoding=new UTF8Encoding(false);string root=AppDomain.CurrentDomain.BaseDirectory;
  string command=args[0],raw=args.Length>1?Encoding.UTF8.GetString(Convert.FromBase64String(args[1].Substring(7))):null;
  var input=raw!=null&&raw.StartsWith("{")?json.Deserialize<Dictionary<string,object>>(raw):new Dictionary<string,object>();
  var db=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"catalog.json"),Encoding.UTF8));
  string file=Path.Combine(root,"fake-state.json");var state=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8));
  var stock=Dict(state["stock"]);var works=Rows(state["works"]).ToList();string name=Text(input,"displayName");
  object result=null;
  switch(command){
   case "status":result=new{pipe="connected"};break;
   case "capabilities":result=new{commands=new[]{"get_gatherable_items","get_craftable_items","get_alterable_items","get_altering_works","get_items","get_my_info","get_activity","get_currencies","execute_gathering","execute_crafting","execute_altering","complete_altering_work","stop_action"}.Select(c=>new{Command=c}).ToArray()};break;
   case "get_items":result=stock.Select(i=>new{DisplayName=i.Key,Count=Convert.ToInt32(i.Value),Location="inventory",IsLocked=false}).ToArray();break;
   case "get_activity":result=new{IsAutoPlaying=false,IsAutoTraveling=false,Mode=new{MainButtonState="Compass"}};break;
   case "get_my_info":result=new{Vitals=new{InventoryWeightCurrent=10,InventoryWeightMax=100}};break;
   case "get_currencies":result=new[]{new{DisplayName="정령의 날개",Amount=100000}};break;
   case "get_gatherable_items":result=new{items=Rows(db["gather"]).Select(r=>new{DisplayName=Text(r,"name"),ToolOk=true}).ToArray()};break;
   case "get_altering_works":result=new{works=works};break;
   case "get_craftable_items":case "get_alterable_items":{
    bool craft=command=="get_craftable_items";var list=new List<object>();
    foreach(var r in Rows(db[craft?"crafts":"materials"]).Where(r=>raw==null||Text(r,"name").Contains(raw))){
     var missing=Rows(r["ingredients"]).Where(i=>Convert.ToInt32(Get(stock,Text(i,"name"))??0)<Convert.ToInt32(i["required"])).Select(i=>new{DisplayName=Text(i,"name"),Required=Convert.ToInt32(i["required"]),Owned=Convert.ToInt32(Get(stock,Text(i,"name"))??0)}).ToArray();
     var row=new Dictionary<string,object>{{"DisplayName",r["name"]},{craft?"Craftable":"Alterable",missing.Length==0},{craft?"ProducedPerCraft":"ProducedPerWork",r["produced"]}};
     if(missing.Length>0){row["Reason"]="not_enough_ingredient";row["MissingIngredients"]=missing;}list.Add(row);
    }
    result=new{items=list};break;
   }
   case "stop_action":File.WriteAllText(Path.Combine(root,"stop.signal"),"stop");result=new{};break;
   case "execute_gathering":stock[name]=Convert.ToInt32(Get(stock,name)??0)+100;result=new{result="completed",gained=100};break;
   case "execute_crafting":case "execute_altering":{
    bool craft=command=="execute_crafting";int count=craft?Convert.ToInt32(Get(input,"craftCount")??1):1;
    var recipe=Rows(db[craft?"crafts":"materials"]).First(r=>Text(r,"name")==name);
    if(Get(state,"slow") is bool&&(bool)state["slow"]){
     string stop=Path.Combine(root,"stop.signal");if(File.Exists(stop))File.Delete(stop);File.WriteAllText(Path.Combine(root,"started.signal"),"started");
     for(int i=0;i<200;i++){if(File.Exists(stop)){result=new{result="stopped_by_user",message="Crafting was stopped before completion. Nothing new was produced."};goto finished;}Thread.Sleep(100);}
    }
    foreach(var i in Rows(recipe["ingredients"]))stock[Text(i,"name")]=Convert.ToInt32(Get(stock,Text(i,"name"))??0)-Convert.ToInt32(i["required"])*count;
    if(craft){stock[name]=Convert.ToInt32(Get(stock,name)??0)+Convert.ToInt32(recipe["produced"])*count;result=new{result="completed",craftCount=count};}
    else{works.Add(new Dictionary<string,object>{{"DisplayName",name},{"FacilityName",recipe["facility"]},{"RemainingSeconds",0},{"State","Completed"},{"IsCompleted",true}});result=new{result="started"};}
    break;
   }
   case "complete_altering_work":{
    var first=works.First(w=>Text(w,"DisplayName")==name);string facility=Text(first,"FacilityName");var ready=works.Where(w=>Text(w,"FacilityName")==facility).ToList();
    foreach(var w in ready){var recipe=Rows(db["materials"]).First(r=>Text(r,"name")==Text(w,"DisplayName"));string output=Text(recipe,"name").Split('(')[0].Trim();stock[output]=Convert.ToInt32(Get(stock,output)??0)+Convert.ToInt32(recipe["produced"]);works.Remove(w);}
    result=new{result="completed",collected=ready.Count};break;
   }
   default:result=new{error="unsupported_command",message=command};break;
  }
  finished:
  if(command.StartsWith("execute_")||command=="complete_altering_work"){state["works"]=works;File.WriteAllText(file,json.Serialize(state),new UTF8Encoding(false));}
  Console.WriteLine(json.Serialize(result));
 }
}
