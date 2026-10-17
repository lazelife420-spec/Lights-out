'use strict';
const model = require('./routineModel'), crypto = require('node:crypto');
const portable = model.interchange;
function createStore({ read, write, getProfiles = () => [], newId = () => crypto.randomUUID() }) {
  const load = () => structuredClone(read() || {});
  const library = c => c.portable || { routines: [], rules: [] };
  const existing = c => ({ routines: [...getProfiles().map(p=>p.id), ...(c.builtin?.rules || []).map(r=>r.id), ...library(c).routines.map(r=>r.intent.id)],
    rules: [...(c.builtin?.rules || []).map(r=>r.id), ...library(c).rules.map(r=>r.id)] });
  function selectedDocument(selection) {
    if (!Array.isArray(selection) || !selection.length || selection.length > 32) throw Error('Select up to 32 routines or rules');
    const c = load(), p = library(c), routines = new Map(), rules = new Map();
    function addRoutine(r) { const old=routines.get(r.id); if(old&&JSON.stringify(old)!==JSON.stringify(r))throw Error('Conflicting source routine identities');routines.set(r.id,r); }
    function addRule(rule) {
      const plan=model.fromWindowsRule(rule), intent=portable.fromPlan(plan); addRoutine(intent);
      const s=plan.schedule;const {lateSeconds: _late,...schedule}=s;
      rules.set(rule.id,{id:rule.id,routineId:intent.id,name:intent.name,schedule});
    }
    for (const item of selection) {
      if (!item || !['profile','rule','portable'].includes(item.kind) || typeof item.id!=='string') throw Error('Choose an available export source');
      if (item.kind==='rule') {
        const rule=(c.builtin?.rules || []).find(r=>r.id===item.id);if(!rule)throw Error('A selected rule is unavailable');addRule(rule);
      } else if(item.kind==='profile') {
        const profile=getProfiles().find(r=>r.id===item.id);if(!profile||profile.mode!=='duration')throw Error('Only duration profiles are portable in v1');
        const plan=model.fromWindowsRule({id:profile.id,label:profile.name,days:['mon'],time:'22:00',durationMinutes:profile.seconds/60,action:profile.action});
        plan.actions[0].parameters.seconds=profile.seconds;addRoutine(portable.fromPlan(plan));
        // Windows' existing canonical model treats each rule as its own
        // executable plan, preserving overrides of the selected profile.
        for(const rule of c.builtin?.rules || [])if(rule.profileId===profile.id)addRule(rule);
      } else {
        const entry=p.routines.find(r=>r.intent.id===item.id);if(!entry)throw Error('An imported routine is unavailable');
        addRoutine(entry.intent);
        for(const rule of p.rules.filter(r=>r.routineId===item.id)) {
          const native=(c.builtin?.rules || []).find(r=>r.id===rule.id);
          if(entry.adopted && native && (native.durationMinutes*60!==entry.local.seconds || native.action!==entry.local.endAction))addRule(native);
          else {
            let schedule=rule.schedule;
            if(entry.adopted&&native){const {lateSeconds: _late,...s}=model.fromWindowsRule(native).schedule;schedule=s;}
            rules.set(rule.id,{...rule,name:entry.adopted&&native ? (native.label || rule.name) : rule.name,schedule});
          }
        }
      }
    }
    return portable.validate({format:'lights-out.routines',schemaVersion:1,routines:[...routines.values()],rules:[...rules.values()]});
  }
  return {
    list() {
      const c=load(),p=library(c);
      return { platform:'windows', choices:[
        ...getProfiles().filter(r=>r.mode==='duration'&&['shutdown','sleep','hibernate'].includes(r.action)).map(r=>({kind:'profile',id:r.id,name:r.name+' · saved timer'})),
        ...(c.builtin?.rules || []).map(r=>({kind:'rule',id:r.id,name:(r.label || 'Routine')+' · calendar rule'})),
        ...p.routines.map(r=>({kind:'portable',id:r.intent.id,name:r.intent.name+' · imported'}))],
        drafts:p.routines.map(r=>({...r,rules:p.rules.filter(rule=>rule.routineId===r.intent.id)})), lights:[] };
    },
    export: selectedDocument,
    preview(text) { return portable.inspect(portable.parse(text),'windows',existing(load())); },
    import(text,policy='reject') {
      const c=load(),p=library(c),d=portable.prepare(portable.parse(text),existing(c),policy,newId);
      if(p.routines.length+d.routines.length>32||p.rules.length+d.rules.length>64)throw Error('Keep up to 32 imported routines and 64 imported rules');
      c.portable={routines:[...p.routines,...d.routines.map(intent=>({intent,adopted:false}))],rules:[...p.rules,...d.rules]};
      write(c); return {count:d.routines.length};
    },
    adopt(options) {
      const c=load(),p=library(c),entry=p.routines.find(r=>r.intent.id===options?.id);
      if(!entry||entry.adopted)throw Error('Choose an inactive imported routine');
      const rules=p.rules.filter(r=>r.routineId===entry.intent.id),seconds=options.seconds,endAction=options.endAction;
      if(!Number.isInteger(seconds)||seconds<60||seconds>86400||!['shutdown','sleep','hibernate'].includes(endAction))throw Error('Review the duration and choose a supported Windows ending');
      if(rules.length&&seconds<300)throw Error('Choose at least 5 minutes for Windows calendar rules');
      if(entry.intent.actions.some(a=>a.type.startsWith('wiz.'))&&options.omitLights!==true)throw Error('Explicitly omit unavailable WiZ actions to use this routine on the PC');
      const old=c.builtin?.rules || [];if(rules.some(r=>old.some(n=>n.id===r.id)))throw Error('A calendar identity now conflicts; existing rules were not changed');
      if(old.length+rules.length>64)throw Error('Keep up to 64 calendar rules');
      const timer=entry.intent.actions.find(a=>a.type==='timer.start');
      entry.intent={...entry.intent,actions:[{...timer,parameters:{seconds,endAction}}]};
      entry.adopted=true;entry.local={seconds,endAction};
      const days=['','mon','tue','wed','thu','fri','sat','sun'];
      const added=rules.map(r=>({id:r.id,label:r.name,repeat:r.schedule.kind,time:r.schedule.time,days:r.schedule.weekdays.map(d=>days[d]),
        monthDays:r.schedule.monthDays,months:r.schedule.months,date:r.schedule.date,durationMinutes:seconds/60,action:endAction,actionId:timer.id,
        testMode:true,enabled:false,profileId:null,portableRoutineId:entry.intent.id}));
      added.forEach(r=>{r.plan=model.fromWindowsRule(r);});
      c.builtin={...c.builtin,rules:[...old,...added]};c.portable=p;write(c);return {count:added.length};
    },
    timerOptions(id) {
      const entry=library(load()).routines.find(r=>r.intent.id===id&&r.adopted);
      if(!entry)throw Error('Review and adopt this routine before starting it');
      if(!Number.isInteger(entry.local?.seconds)||!['shutdown','sleep','hibernate'].includes(entry.local?.endAction))throw Error('Review this local timer again');
      return {durationSeconds:entry.local.seconds,action:entry.local.endAction,dryRun:true,forceShutdown:false,origin:'schedule',profileId:null,nightModeId:''};
    }
  };
}
module.exports={createStore};
