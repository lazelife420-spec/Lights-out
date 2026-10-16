// Small, session-only surprises. This file deliberately has no API bridge:
// discovering a signature can never start a timer or change a light.
/* exported setupBrandSignature */
function setupBrandSignature() {
  let resetTimer = null;
  function showStars(kind) {
    document.getElementById('lights-out-signature')?.remove();
    if (resetTimer) clearTimeout(resetTimer);
    const scene=document.createElement('div'); scene.id='lights-out-signature';
    scene.className='lights-out-signature '+kind; scene.setAttribute('aria-hidden','true');
    const constellation=document.createElement('div'); constellation.className='signature-constellation';
    for(let i=0;i<9;i++) {
      const star=document.createElement('span'); star.className='signature-star'; star.textContent='✦';
      star.style.setProperty('--star-i',String(i));
      star.style.setProperty('--star-x',`${[12,32,58,80,24,68,46,86,8][i]}%`);
      star.style.setProperty('--star-y',`${[28,10,18,34,68,78,52,64,84][i]}%`);
      constellation.append(star);
    }
    const caption=document.createElement('span'); caption.className='signature-caption';
    caption.textContent=kind==='knockout'?'Lights out. Stars up.':'Still counting stars.';
    scene.append(constellation,caption); document.body.append(scene);
    const announcer=document.getElementById('session-announcer'); if(announcer) announcer.textContent=caption.textContent;
    resetTimer=setTimeout(()=>{scene.remove();resetTimer=null;},2600);
  }
  function secret(buttonId, count, kind) {
    const button=document.getElementById(buttonId); if(!button) return;
    let taps=0, last=0;
    button.addEventListener('click',()=>{
      const now=Date.now(); taps=now-last>1400?1:taps+1;last=now;
      if(taps>=count){taps=0;showStars(kind);}
    });
  }
  secret('brand-signature',5,'knockout');
  secret('version',7,'constellation');
}
