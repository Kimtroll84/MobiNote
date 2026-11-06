(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MobiWorkTime = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function isCompleted(work){
    if(!work)return false;
    if(work.State==='NotStarted'||work.State==='InProgress')return false;
    return work.State==='Completed'||work.IsCompleted===true;
  }
  function durationFor(work, recipes, membership = true) {
    const multiplier = membership === false ? 2 : 1;
    const candidates = [...new Set(recipes.filter(r => r.name === work.DisplayName).map(r => Number(r.durationSeconds) * multiplier).filter(n => n > 0))];
    // User policy: recipe selection affects materials; time bars always use
    // the shortest same-name duration, including when recipe 2 is selected.
    return candidates.length ? Math.min(...candidates) : null;
  }
  function progress(work, recipes, membership = true) {
    if (isCompleted(work)) return 100;
    if (work.State === 'NotStarted') return 0;
    const duration = durationFor(work, recipes, membership), remaining = Number(work.RemainingSeconds);
    return duration && Number.isFinite(remaining) ? Math.max(0, Math.min(99, 100 * (1 - remaining / duration))) : null;
  }
  function remainingAt(work,receivedAt,now=Date.now()){
    if(isCompleted(work))return 0;
    const remaining=Math.max(0,Number(work.RemainingSeconds)||0);
    if(work.State==='NotStarted'||!Number.isFinite(receivedAt))return remaining;
    return Math.max(0,remaining-Math.floor(Math.max(0,now-receivedAt)/1000));
  }
  return { isCompleted, durationFor, progress, remainingAt };
});
