'use strict';
function position(saved,area,size={width:600,height:230}){
  if(!Number.isFinite(saved?.x)||!Number.isFinite(saved?.y))return null;
  return {x:Math.round(Math.max(area.x,Math.min(saved.x,area.x+Math.max(0,area.width-size.width)))),y:Math.round(Math.max(area.y,Math.min(saved.y,area.y+Math.max(0,area.height-size.height))))};
}
module.exports={position};
