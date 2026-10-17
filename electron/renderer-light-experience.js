/* global document, LightExperience */
(function(){'use strict';
 const preview=document.getElementById('wiz-mode-preview'),mode=document.getElementById('sel-light-mode'),progress=document.getElementById('wiz-mode-preview-progress');if(!preview||!mode||!progress)return;
 const started=performance.now();
 function draw(){const selected=['hourglass','orbit','ember'].includes(mode.value);preview.hidden=!selected;if(!selected||!preview.getClientRects().length)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;const seconds=reduced?0:(performance.now()-started)/1000;
  [...preview.querySelectorAll('i')].forEach((orb,index)=>{const frame=LightExperience.frame(mode.value,{progress:Number(progress.value)/100,elapsedSeconds:seconds,index,count:4,brightness:40});orb.style.background=`rgb(${frame.r},${frame.g},${frame.b})`;orb.style.color=orb.style.background;orb.style.opacity=String(.25+frame.dimming/80);});
 }
 mode.addEventListener('change',draw);progress.addEventListener('input',draw);setInterval(()=>{if(!document.hidden)draw();},250);draw();
})();
