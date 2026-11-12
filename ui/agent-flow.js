'use strict';
// Only speech history is timed. New status and task execution are never delayed.
class AgentSpeechHistory {
  constructor(shortMs=2500){this.shortMs=shortMs;this.reset();}
  reset(){this.current=null;this.previous='';this.expiresAt=0;}
  update(stage,text,voice,now){
    if(this.expiresAt&&now>=this.expiresAt){this.previous='';this.expiresAt=0;}
    const exclusive=!!text.detail||!['checking','preparing','craft','register','collect','busy','loading','retry-read'].includes(stage.type);
    const changed=!this.current||this.current.message!==text.message||this.current.voice!==voice||this.current.exclusive!==exclusive||this.current.image!==text.image;
    if(changed){
      const old=this.current;
      const compatible=old&&old.image===text.image&&(!old.item||!stage.item||old.item===stage.item);
      this.previous=compatible&&!old.exclusive&&!exclusive&&old.voice===voice&&now-old.since<this.shortMs&&old.message!==text.message?old.message:'';
      this.expiresAt=this.previous?now+this.shortMs:0;
      this.current={message:text.message,voice,exclusive,image:text.image,item:stage.item,since:now};
    }
    if(exclusive){this.previous='';this.expiresAt=0;}
    return {previous:this.previous,expiresAt:this.expiresAt};
  }
  expire(now){if(this.expiresAt&&now>=this.expiresAt){this.previous='';this.expiresAt=0;}return this.previous;}
}
globalThis.AgentSpeechHistory=AgentSpeechHistory;
if(typeof module!=='undefined')module.exports={AgentSpeechHistory};
