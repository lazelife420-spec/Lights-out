/* Shared offline transfer UI. Platform adapters own file pickers and writes. */
/* global document */
(function(root) {
  'use strict';
  function mount(container, adapter) {
    const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
    const button=(text,fn)=>{const e=node('button',text,'btn-secondary');e.type='button';e.onclick=()=>void run(fn);return e;};
    const choice=(text,checked=false)=>{const label=node('label',undefined,'transfer-choice'),input=node('input');input.type='checkbox';input.checked=checked;label.append(input,document.createTextNode(text));return{label,input};};
    const status=node('p','Files contain routine intent only. Times use the receiving device’s local timezone.','transfer-note');status.setAttribute('role','status');
    const choices=node('div',undefined,'transfer-choices'),drafts=node('div',undefined,'transfer-drafts'),preview=node('div',undefined,'transfer-preview');
    let data={choices:[],drafts:[],lights:[]},pendingText=null,busy=false;
    async function run(fn) {if(busy)return;busy=true;container.setAttribute('aria-busy','true');try{await fn();}catch(e){status.textContent=(e.message || 'Could not complete this file operation.').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,'');}finally{busy=false;container.removeAttribute('aria-busy');}}
    const exportButton=button('Export selected',async()=>{
      const selected=[...choices.querySelectorAll('input:checked')].map(e=>JSON.parse(e.value));
      if(!selected.length)throw Error('Select at least one routine or rule.');
      const result=await adapter.exportFile(selected);status.textContent=result.cancelled?'Export cancelled.':'Routine file saved. No addresses or execution history were exported.';
    });exportButton.dataset.transfer='export';
    const open=button('Open routine file',async()=>{pendingText=null;preview.replaceChildren();const result=await adapter.openFile();if(result.cancelled)return;await showPreview(result.text);});open.dataset.transfer='open';
    container.append(node('h3','Routine files'),node('p','Move routines between devices with an offline JSON file. Import saves drafts. Review actions before adopting; calendar rules stay off.','transfer-note'),choices,exportButton,open,status,preview,drafts);
    if(adapter.platform==='windows')container.insertBefore(node('p','Test Mode skips the final PC power action. Other wind-down effects you enabled may still run.','transfer-note'),choices);
    async function showPreview(text) {
      pendingText=null;preview.replaceChildren();
      const result=await adapter.preview(text);pendingText=text;
      preview.append(node('h4','Review file contents'));
      for(const r of result.routines){const row=node('article',undefined,'transfer-item');row.append(node('strong',r.name),node('p',r.actions.map(a=>actionText(a)).join(' · ')));
        for(const issue of r.issues)row.append(node('p',issue,'transfer-warning'));if(r.conflict)row.append(node('p','Routine ID already exists.','transfer-warning'));preview.append(row);}
      for(const r of result.document.rules)preview.append(node('p',`${r.name} · ${ruleText(r.schedule)}${result.conflicts.rules.includes(r.id)?' · ID conflict':''}`));
      const copy=choice('Import conflicting records as new copies');copy.input.dataset.transfer='copy';preview.append(copy.label,node('p',result.note,'transfer-note'));
      const save=button('Save inactive drafts',async()=>{if(pendingText===null)throw Error('Open the file again.');const r=await adapter.commitImport(pendingText,copy.input.checked?'copy':'reject');pendingText=null;preview.replaceChildren();status.textContent=`Saved ${r.count} inactive routine(s). Nothing started or scheduled.`;await refresh();});save.dataset.transfer='save';preview.append(save);
    }
    function actionText(a){if(a.type==='timer.start')return`${a.parameters.seconds/60} min timer → ${a.parameters.endAction}`;
      return`${a.type==='wiz.warm'?'Warm WiZ lights':'WiZ lights off'} · ${a.parameters.bindings.join(', ')}${a.type==='wiz.warm'?' · '+a.parameters.brightness+'%':''}`;}
    function ruleText(s){const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],days=['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const repeat=s.kind==='once'?s.date:s.kind==='weekly'?'Weekly '+s.weekdays.map(n=>days[n]).join(', '):'Monthly '+s.monthDays.map(n=>n===-1?'last day':n).join(', ');
      return`${repeat} · ${s.time}${s.kind==='once'?'':' · '+s.months.map(n=>months[n-1]).join(', ')}`;
    }
    function review(entry,card){
      const form=node('div',undefined,'transfer-adoption'),timer=entry.intent.actions.find(a=>a.type==='timer.start');
      const label=node('label','Timer duration · seconds'),duration=node('input');duration.type='number';duration.min=adapter.platform==='windows'&&entry.rules.length?'300':'60';duration.max='86400';duration.step='1';duration.value=String(timer.parameters.seconds);label.append(duration);
      const endingLabel=node('label','Local timer ending'),ending=node('select');const endings=adapter.platform==='windows'?['shutdown','sleep','hibernate']:['reminder'];
      const empty=node('option','Choose an ending');empty.value='';ending.append(empty);for(const value of endings){const o=node('option',value==='reminder'?'Phone reminder':value);o.value=value;ending.append(o);}ending.value=endings.includes(timer.parameters.endAction)?timer.parameters.endAction:'';endingLabel.append(ending);form.append(label,endingLabel);
      if(ending.value==='')form.append(node('p','The imported ending is unavailable here. Choose its replacement explicitly.','transfer-warning'));
      if(adapter.platform==='windows'&&entry.rules.length&&timer.parameters.seconds<300)form.append(node('p','Windows scheduled timers require at least 300 seconds. Review the duration.','transfer-warning'));
      const lightActions=entry.intent.actions.filter(a=>a.type.startsWith('wiz.')),omit=choice('Explicitly omit imported lighting actions');
      const bindings=Object.create(null);if(lightActions.length){form.append(omit.label);
        if(adapter.platform==='windows')form.append(node('p','This PC routine adapter cannot execute these WiZ actions.','transfer-warning'));
        else for(const slot of [...new Set(lightActions.flatMap(a=>a.parameters.bindings))]){const l=node('label','Bind '+slot+' to a saved phone light'),s=node('select');const o=node('option','Choose a saved light');o.value='';s.append(o);for(const ip of data.lights){const option=node('option',ip);option.value=ip;s.append(option);}bindings[slot]=s;l.append(s);form.append(l);}
      }
      const acknowledge=choice(adapter.platform==='windows'?'Use the reviewed PC actions in Test Mode; save schedules disabled.':'Use the reviewed phone actions; save schedules disabled.');acknowledge.input.dataset.transfer='acknowledge';form.append(acknowledge.label);
      const adopt=button('Adopt on this device',async()=>{
        if(!acknowledge.input.checked)throw Error('Confirm the reviewed local actions first.');
        const r=await adapter.adopt({id:entry.intent.id,seconds:Number(duration.value),endAction:ending.value,omitLights:omit.input.checked,bindings:Object.fromEntries(Object.entries(bindings).map(([id,s])=>[id,s.value]))});
        status.textContent=`Routine adopted. ${r.count} calendar rule(s) saved disabled. Enable rules in Calendar or Schedule when ready.`;await refresh();
      });adopt.dataset.transfer='adopt';form.append(adopt);card.append(form);
    }
    async function refresh(){data=await adapter.list();choices.replaceChildren();drafts.replaceChildren();
      for(const c of data.choices){const row=choice(c.name);row.input.value=JSON.stringify({kind:c.kind,id:c.id});choices.append(row.label);}
      if(!data.choices.length)choices.append(node('p','Save or import a routine to export it.','transfer-note'));
      for(const entry of data.drafts){const card=node('article',undefined,'transfer-item');card.dataset.routineId=entry.intent.id;
        card.append(node('strong',entry.intent.name),node('p',entry.intent.actions.map(actionText).join(' · ')),node('p',entry.adopted?'Adopted locally · rules were saved disabled':'Inactive draft · nothing can run yet','transfer-note'));
        if(!entry.adopted){const b=button('Review local actions',async()=>{b.disabled=true;review(entry,card);});b.dataset.transfer='review';card.append(b);}
        else if(adapter.start){const b=button(adapter.platform==='windows'?'Start in Test Mode':'Start phone routine',()=>adapter.start(entry.intent.id));b.dataset.transfer='start';card.append(b);}
        drafts.append(card);
      }
    }
    void run(refresh);return{refresh,preview:text=>run(()=>showPreview(text))};
  }
  root.RoutineTransferUI={mount};
})(globalThis);
