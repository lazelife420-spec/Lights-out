'use strict';

const dgram = require('node:dgram');

function normalizeCandidateIps(candidateIps) {
  if (!Array.isArray(candidateIps)) return [];
  return [...new Set(candidateIps
    .filter(ip => typeof ip === 'string')
    .map(ip => ip.trim())
    .filter(ip => ip && ip !== '127.0.0.1'))];
}

function selectLanIp(candidateIps, preferredIp = '', routedIp = '') {
  const candidates = normalizeCandidateIps(candidateIps);
  const preferred = typeof preferredIp === 'string' ? preferredIp.trim() : '';
  const routed = typeof routedIp === 'string' ? routedIp.trim() : '';
  const lanIp = routed && candidates.includes(routed)
    ? routed
    : (preferred && candidates.includes(preferred) ? preferred : (candidates[0] || ''));
  return {
    candidates,
    lanIp,
    hasLanIp: Boolean(lanIp)
  };
}

function networkFingerprint(candidateIps, routedIp = '') {
  return `${String(routedIp || '').trim()}::${normalizeCandidateIps(candidateIps).sort().join('|')}`;
}

function getRoutedLanIp() {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      resolve(value || '');
    };
    socket.once('error', () => done(''));
    socket.connect(53, '1.1.1.1', () => {
      try { done(socket.address().address); } catch { done(''); }
    });
    setTimeout(() => done(''), 1000).unref?.();
  });
}

module.exports = { normalizeCandidateIps, selectLanIp, networkFingerprint, getRoutedLanIp };
