'use strict';

// WiZ local UDP API. Discovery and verification only read state. Commands go
// to explicitly configured private IPv4 addresses, never to a broadcast.
const dgram = require('node:dgram');
const net = require('node:net');
const os = require('node:os');
const PORT = 38899;

function isLocalAddress(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a, b, c, d] = ip.split('.').map(Number);
  return d !== 255 && d !== 0 && (a === 10 || a === 127 ||
    (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254 && c !== 255));
}

function normalizeAddresses(value) {
  const parts = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
  return [...new Set(parts.map(ip => String(ip).trim()).filter(isLocalAddress))].sort().slice(0, 32);
}

function request(ip, method, params = {}, { port = PORT, timeoutMs = 1500 } = {}) {
  if (!isLocalAddress(ip)) return Promise.resolve({ success: false, code: 'INVALID_ADDRESS', message: 'Enter a local WiZ light IP address.' });
  if (!['getPilot', 'getSystemConfig', 'setPilot'].includes(method)) return Promise.resolve({ success: false, code: 'INVALID_METHOD' });
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    let done = false;
    const finish = value => {
      if (done) return;
      done = true; clearTimeout(timer);
      try { socket.close(); } catch { /* bind may have failed */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish({ success: false, code: 'TIMEOUT', message: 'WiZ did not answer. Check Wi-Fi and Allow local communication in the WiZ app.' }), timeoutMs);
    socket.on('error', () => finish({ success: false, code: 'NETWORK_ERROR', message: 'Could not reach WiZ on the local network.' }));
    socket.on('message', (data, remote) => {
      if (remote.address !== ip || remote.port !== port || data.length > 8192) return;
      let reply;
      try { reply = JSON.parse(data.toString('utf8')); } catch { return; }
      if (reply?.method !== method) return;
      if (reply.error) return finish({ success: false, code: 'DEVICE_REJECTED', message: 'WiZ rejected the command. Check the device firmware and local communication setting.' });
      if (!reply.result || typeof reply.result !== 'object' || Array.isArray(reply.result)) return;
      if (method === 'setPilot' && reply.result.success !== true) return finish({ success: false, code: 'DEVICE_REJECTED', message: 'WiZ did not confirm the light change.' });
      if (method === 'getPilot' && typeof reply.result.state !== 'boolean') return;
      finish({ success: true, result: reply.result });
    });
    socket.bind(0, () => {
      if (done) return;
      socket.send(Buffer.from(JSON.stringify({ method, params })), port, ip, error => {
        if (error) finish({ success: false, code: 'NETWORK_ERROR', message: 'Could not send the WiZ request.' });
      });
    });
  });
}

function broadcastAddresses() {
  const addresses = new Set(['255.255.255.255']);
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (!iface || iface.internal || iface.family !== 'IPv4' || !isLocalAddress(iface.address)) continue;
    const ip = iface.address.split('.').map(Number), mask = iface.netmask.split('.').map(Number);
    addresses.add(ip.map((n, i) => n | (255 ^ mask[i])).join('.'));
  }
  return [...addresses];
}

function discover({ timeoutMs = 2200, broadcasts = broadcastAddresses(), port = PORT } = {}) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    const found = new Map(); let done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      try { socket.close(); } catch { /* bind may have failed */ }
      resolve([...found.values()].sort((a, b) => a.ip.localeCompare(b.ip)));
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on('error', finish);
    socket.on('message', (data, remote) => {
      if (data.length > 8192 || remote.port !== port || !isLocalAddress(remote.address)) return;
      try {
        const reply = JSON.parse(data.toString('utf8'));
        if (reply.method !== 'getPilot' || typeof reply.result?.state !== 'boolean' || !/^[a-f\d]{12}$/i.test(reply.result?.mac || '')) return;
        found.set(remote.address, { ip: remote.address, on: reply.result.state });
      } catch { /* ignore unrelated LAN messages */ }
    });
    socket.bind(0, () => {
      if (done) return;
      try { socket.setBroadcast(true); } catch { return finish(); }
      const packet = Buffer.from(JSON.stringify({ method: 'getPilot', params: {} }));
      for (const host of broadcasts) socket.send(packet, port, host, () => {});
    });
  });
}

function normalizeLook(value = {}) {
  const bounded = (number, fallback, min, max) => Number.isFinite(Number(number))
    ? Math.max(min, Math.min(max, Math.round(Number(number)))) : fallback;
  return {
    mode: ['current', 'white', 'color', 'scene'].includes(value?.mode) ? value.mode : 'current',
    brightness: bounded(value?.brightness, 50, 10, 100),
    temperature: bounded(value?.temperature, 2700, 2200, 6500),
    color: /^#[a-f\d]{6}$/i.test(value?.color || '') ? value.color : '#ff9f43',
    sceneId: bounded(value?.sceneId, 14, 1, 28)
  };
}

function normalizeDevices(value, selected = []) {
  const devices = new Map(normalizeAddresses(selected).map(ip => [ip, { ip, name: '', room: '' }]));
  for (const device of (Array.isArray(value) ? value : []).slice(0, 64)) {
    if (!device || !isLocalAddress(device.ip)) continue;
    const label = text => typeof text === 'string' ? text.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 60) : '';
    devices.set(device.ip, { ip: device.ip, name: label(device.name), room: label(device.room) });
  }
  return [...devices.values()].slice(0, 64);
}

function lookPilot(value) {
  const look = normalizeLook(value);
  if (look.mode === 'scene') return { sceneId: look.sceneId };
  if (look.mode === 'white') return { temp: look.temperature };
  if (look.mode === 'color') return { r: parseInt(look.color.slice(1, 3), 16), g: parseInt(look.color.slice(3, 5), 16), b: parseInt(look.color.slice(5, 7), 16) };
  return {};
}

function pilotState({ on = true, brightness = 254, colorTemp, look } = {}) {
  if (!on || Number(brightness) <= 0) return { state: false };
  const value = Number.isFinite(Number(brightness)) ? Number(brightness) : 254;
  const pilot = { state: true, dimming: Math.max(10, Math.min(100, Math.round(value / 254 * 100))) };
  if (look) Object.assign(pilot, lookPilot(look));
  else if (Number.isFinite(Number(colorTemp)) && Number(colorTemp) > 0) pilot.temp = Math.max(2200, Math.min(6500, Math.round(1000000 / Number(colorTemp))));
  return pilot;
}

async function verify(addresses) {
  const ips = normalizeAddresses(addresses);
  if (!ips.length) return { success: false, code: 'NOT_CONFIGURED', message: 'Discover WiZ lights or enter their local IP addresses.' };
  const replies = await Promise.all(ips.map(ip => request(ip, 'getPilot')));
  const reachable = replies.filter(reply => reply.success).length;
  return { success: reachable === ips.length, code: reachable === ips.length ? 'VERIFIED' : 'UNREACHABLE',
    message: reachable === ips.length ? `Connected: ${reachable} WiZ light(s). No light was changed.` : `${reachable} of ${ips.length} WiZ lights answered. Check Wi-Fi and Allow local communication in the WiZ app.`, reachable, total: ips.length };
}

async function setLights(addresses, options, requestOptions, { preservePower = false, released = new Set(), isCurrent = () => true } = {}) {
  const ips = normalizeAddresses(addresses);
  if (!ips.length) return { success: false, code: 'NOT_CONFIGURED', message: 'No WiZ lights configured.' };
  const replies = await Promise.all(ips.map(async ip => {
    if (preservePower && released.has(ip)) return { success: true, skipped: true };
    const params = pilotState(options);
    if (preservePower && params.state) {
      const live = await request(ip, 'getPilot', {}, requestOptions);
      if (!live.success) return live;
      if (!live.result.state) { released.add(ip); return { success: true, skipped: true }; }
      delete params.state;
    }
    if (!isCurrent()) return { success: true, skipped: true };
    return request(ip, 'setPilot', params, requestOptions);
  }));
  const changed = replies.filter(reply => reply.success && !reply.skipped).length;
  const skipped = replies.filter(reply => reply.skipped).length;
  const success = replies.every(reply => reply.success);
  return { success, code: success ? 'OK' : 'PARTIAL', message: `${changed} of ${ips.length} WiZ lights confirmed the change.${skipped ? ` ${skipped} left under manual control.` : ''}` };
}

async function readStates(addresses, requestOptions) {
  const ips=normalizeAddresses(addresses);
  const replies=await Promise.all(ips.map(async ip=>({ip,reply:await request(ip,'getPilot',{},requestOptions)})));
  return replies.filter(item=>item.reply.success).map(item=>({ip:item.ip,pilot:item.reply.result}));
}

function restorePilot(pilot) {
  if(pilot.state!==true)return{state:false};
  const result={state:true};
  if(Number.isFinite(pilot.dimming))result.dimming=Math.max(10,Math.min(100,Math.round(pilot.dimming)));
  if(Number.isInteger(pilot.sceneId)&&pilot.sceneId>0&&pilot.sceneId<1000)result.sceneId=pilot.sceneId;
  else if(Number.isFinite(pilot.temp)&&pilot.temp>0)result.temp=Math.max(1000,Math.min(12000,Math.round(pilot.temp)));
  else for(const key of ['r','g','b','c','w'])if(Number.isInteger(pilot[key]))result[key]=Math.max(0,Math.min(255,pilot[key]));
  return result;
}

async function dimStates(snapshot,progress,warm,requestOptions, { look, isCurrent = () => true } = {}) {
  progress=Math.max(0,Math.min(1,Number(progress)||0));
  const chosen = normalizeLook(look);
  const replies=await Promise.all(snapshot.filter(item=>item.pilot.state===true && !item.released && !item.finished).map(async item=>{
    // Recheck the live power state. An off command from WiZ yields this light
    // for the rest of the run, including cancel/restore. Unreachable lights
    // are skipped rather than written from a stale snapshot.
    const live = await request(item.ip, 'getPilot', {}, requestOptions);
    if (!isCurrent()) return { success: true };
    if (!live.success) return live;
    if (!live.result.state) { item.released = true; return { success: true }; }
    const baseline = chosen.mode !== 'current' ? chosen.brightness
      : Number.isFinite(item.pilot.dimming) ? Math.max(10, Math.min(100, item.pilot.dimming)) : 10;
    // Brightness/mode changes are separate from power in the WiZ local API.
    // Never include state:true in an automatic dim, even between read/write.
    const params=progress>=1?{state:false}:{dimming:Math.max(10,Math.round(baseline*(1-progress)))};
    if (progress < 1 && !item.lookApplied) Object.assign(params, lookPilot(chosen));
    if(warm&&progress<1)params.temp=Math.max(2200,Math.round((chosen.mode === 'white' ? chosen.temperature : Number(item.pilot.temp)||2700)*(1-progress)+2200*progress));
    if (warm) { delete params.sceneId; delete params.r; delete params.g; delete params.b; }
    const reply = await request(item.ip,'setPilot',params,requestOptions);
    if (reply.success) { item.changed = true; item.lookApplied = true; if (progress >= 1) item.finished = true; }
    return reply;
  }));
  return {success:replies.every(reply=>reply.success)};
}

async function restoreStates(snapshot,requestOptions) {
  const replies=await Promise.all((snapshot||[]).filter(item => item.pilot.state === true && !item.released && item.changed).map(async item=>{
    const live = await request(item.ip, 'getPilot', {}, requestOptions);
    if (!live.success) return live;
    if (!live.result.state) { item.released = true; return { success: true }; }
    const params = restorePilot(item.pilot);
    // Cancel never powers a light on, including an off between read/write.
    delete params.state;
    return request(item.ip,'setPilot',params,requestOptions);
  }));
  return {provider:'wiz',success:replies.every(reply=>reply.success),code:replies.every(reply=>reply.success)?'RESTORED':'RESTORE_PARTIAL',message:replies.every(reply=>reply.success)?'WiZ lights restored.':'Some WiZ lights could not be restored.'};
}

module.exports = { PORT, isLocalAddress, normalizeAddresses, normalizeDevices, normalizeLook, lookPilot, request, discover, pilotState, verify, setLights, readStates, restorePilot, dimStates, restoreStates };
