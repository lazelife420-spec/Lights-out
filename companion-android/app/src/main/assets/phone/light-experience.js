/* Shared WiZ intent only; adapters retain power, ownership and manual-off guards. */
(function(root){
 'use strict';
 const modes=['off','hourglass','orbit','ember'];
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:min));
 function normalize(value={}){return {timerMode:modes.includes(value.timerMode)?value.timerMode:'off',brightness:Math.round(clamp(Number(value.brightness)||35,10,60)),timerAlerts:value.timerAlerts===true,appAlerts:value.appAlerts===true};}
 function mix(a,b,t){return a.map((v,i)=>Math.round(v+(b[i]-v)*t));}
 function frame(mode,{progress=0,elapsedSeconds=0,index=0,count=1,brightness=35}={}){
  if(!modes.includes(mode)||mode==='off')return null;
  const p=clamp(progress,0,1),seconds=clamp(elapsedSeconds,0,86400),n=Math.max(1,Math.floor(clamp(count,1,32))),i=Math.floor(clamp(index,0,n-1)),peak=clamp(brightness,10,60);
  let rgb,level;
  if(mode==='hourglass'){
   const local=clamp(p*n-i,0,1);rgb=mix([255,176,76],[255,72,18],local);level=10+(peak-10)*(1-local);
  }else if(mode==='orbit'){
   // A twenty-four-second orbit; elapsed time is supplied by the owning timer.
   const wave=(1+Math.cos(2*Math.PI*(seconds/24-i/n)))/2;
   rgb=mix(mix([62,145,255],[175,88,235],wave),[255,123,38],p*p);
   level=10+(peak-10)*(1-p)*(.5+.5*wave);
  }else{
   const breath=(1+Math.sin(2*Math.PI*seconds/12))/2;
   rgb=mix([255,126,34],[255,54,12],p);level=10+(peak-10)*(1-p)*(.88+.12*breath);
  }
  return {r:rgb[0],g:rgb[1],b:rgb[2],dimming:Math.round(clamp(level,10,60))};
 }
 function beacon({elapsedSeconds=0,brightness=35,index=0,count=1}={}){
  const t=clamp(elapsedSeconds,0,6);if(t>=6)return null;
  const delay=clamp(index,0,31)/Math.max(1,clamp(count,1,32))*.6;
  const wave=Math.sin(Math.PI*Math.max(0,t-delay)/3);
  return {r:128,g:192,b:255,dimming:Math.round(10+(clamp(brightness,10,60)-10)*wave*wave)};
 }
 const api={modes,normalize,frame,beacon};if(typeof module==='object'&&module.exports)module.exports=api;else root.LightExperience=api;
})(globalThis);
