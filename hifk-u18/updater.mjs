// HIFK U18 -seuranta: hakee U18 SM-sarjan datan tulospalvelu.leijonat.fi:stä ja kirjoittaa data.json-tiedoston.
// Käyttö: NODE_USE_ENV_PROXY=1 node updater.mjs data.json
// build(get) on puhdas funktio: get(polku) palauttaa JSONin tulospalvelun polusta.

const SEASON = 2027;
const SUBSERIE = 1348; // U18 SM, alkusarja
const FOCUS = 'HIFK';

async function build(get, today) {
  const q = o => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  const sub = await get('/serie/helpers/getsubserie?' + q({ season: SEASON, subSerieId: SUBSERIE, teamid: 0 }));
  const abbr = {};
  for (const t of sub.teams) abbr[t.TeamID] = t.TeamAbbrv;

  const st = await get('/serie/helpers/getstandings?' + q({ season: SEASON, subSerieId: SUBSERIE }));

  const gl = await get('/helpers/getgames?' + q({ dwl: 0, season: SEASON, subSerieId: SUBSERIE, teamid: 0, districtid: 0, gamedays: -1, dog: today, levelid: -1 }));
  const rawGames = gl.flatMap(l => l.Games || []);
  if (rawGames.length < 10) throw new Error('liian vähän otteluita: ' + rawGames.length);

  const pq = q({
    season: SEASON, type: 0, teamid: 0, nop: 0,
    'filters[Games]': '', 'filters[Strength]': '', 'filters[Rookies]': 0, 'filters[Total]': 0,
    'filters[Period]': '', 'filters[SortOrder]': 'DESC', 'filters[SortedBy]': 'PlayerPoints',
    subSerieId: SUBSERIE,
  });
  const pl = (await get('/helpers/getplayers?' + pq)).Players || [];
  if (pl.length < 50) throw new Error('liian vähän pelaajia: ' + pl.length);

  // Pelinumerot ja kätisyys joukkueiden sarjarostereista
  const roster = {};
  for (const t of sub.teams) {
    try {
      const r = await get('/helpers/getteamserieroster?' + q({ season: SEASON, teamid: t.TeamID, serieId: sub.serieId }));
      for (const p of r.Players || []) roster[p.PlayerID] = { no: p.JerseyNr || p.Number || null, hand: p.Hand || '' };
    } catch (e) { /* rosteri ei ole välttämätön */ }
  }

  // Ottelutapahtumat pelatuista otteluista
  const finished = rawGames.filter(g => g.GameStatus == 2);
  const ev = {};
  const queue = finished.map(g => g.GameID);
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      let d;
      try { d = await get('/gamereport/getgamereportdata?' + q({ gameid: id, season: SEASON })); }
      catch (e) { continue; }
      const out = [];
      for (const e of d.GameLogsUpdate || []) {
        const tm = abbr[e.TeamId] || '';
        if (e.Type === 'Goal') {
          out.push(['G', tm, e.GameTime, (e.ScorerName || '').trim(), (e.FirstAssistName || '').trim(), (e.SecondAssistName || '').trim(), (e.GoalType || '').trim()]);
        } else if (e.Type === 'Penalty') {
          out.push(['P', tm, e.GameTime, (e.Name || '').trim(), e.PenaltyMinutesNumber ?? null, (e.PenaltyReasonsFI || '').trim()]);
        }
      }
      ev[id] = out;
    }
  }
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));

  return {
    v: 1,
    updated: new Date().toISOString(),
    season: SEASON,
    subSerieId: SUBSERIE,
    serie: sub.levelName,
    phase: sub.subSerieName,
    line: +((st.StandingLines || [])[0] || 0),
    focus: FOCUS,
    standings: st.Teams.map(t => [t.TeamAbbrv, t.Games, t.Wins, t.OtWins, t.OtLooses, t.Looses, t.GoalsFor, t.GoalsAgainst, t.Points]),
    games: rawGames.map(g => [
      g.GameID, g.GameDateDB, (g.GameTime || '').slice(0, 5),
      abbr[g.HomeTeam] || g.HomeTeamAbbrv, abbr[g.AwayTeam] || g.AwayTeamAbbrv,
      g.GameStatus == 2 ? g.HomeGoals : null, g.GameStatus == 2 ? g.AwayGoals : null,
      g.GameStatus == 2 ? g.FinishedType : null, g.RinkName || '', g.GameStatus,
    ]),
    players: pl.map(p => [
      p.PlayerID, p.FirstName, p.LastName, p.TeamAbbrv, p.RoleAbbrv,
      (roster[p.PlayerID] || {}).no ?? null, p.PlayerGames, p.PlayerGoals, p.PlayerAssists, p.PlayerPoints,
      p.PlayerPenaltyMin, p.PlayerGoalsPP, p.PlayerGoalsSH, (roster[p.PlayerID] || {}).hand || '', p.PlayerWinGoal,
    ]),
    ev,
  };
}

// ---- CLI ----
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { writeFileSync } = await import('node:fs');
  const BASE = 'https://tulospalvelu.leijonat.fi';
  const get = async (path, tries = 3) => {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(BASE + path, { headers: { accept: 'application/json' } });
        if (!r.ok) throw new Error(r.status + ' ' + path);
        return await r.json();
      } catch (e) {
        if (i + 1 >= tries) throw e;
        await new Promise(res => setTimeout(res, 1500 * (i + 1)));
      }
    }
  };
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
  const data = await build(get, today);
  const out = process.argv[2] || 'data.json';
  writeFileSync(out, JSON.stringify(data));
  console.log(`OK ${out}: ${data.games.length} ottelua, ${data.players.length} pelaajaa, ${Object.keys(data.ev).length} otteluraporttia, päivitetty ${data.updated}`);
}

export { build };
