function minutesNowNC() {
  // Heure actuelle en Pacific/Noumea pour éviter un décalage UTC
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Pacific/Noumea',
    hour12: false,
    hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date());
  const h = +parts.find(p => p.type === 'hour').value;
  const m = +parts.find(p => p.type === 'minute').value;
  return h * 60 + m;
}

function parseHoraires(horaires) {
  const jours = ["DI","LU","MA","ME","JE","VE","SA"];
  const now = new Date();
  const jourActuel = jours[new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', weekday: 'short' })
                          .format(now).toUpperCase().slice(0,2)] || jours[now.getDay()];
  const currentMin = minutesNowNC();

  // Récupère la ligne du jour courant
  const line = horaires.split("<br>").find(l => l.startsWith(jourActuel)) || "";
  const lineNorm = line.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // gérer "Fermé"/"Ferme"
  if (/ferme/i.test(lineNorm)) return { status: "Fermé", next: "Ouvre demain" };

  // Extrait les plages HH:MM-HH:MM
  const matches = [...line.matchAll(/\b(\d{2}):(\d{2})-(\d{2}):(\d{2})\b/g)];
  if (matches.length === 0) return { status: "Fermé", next: "Horaire indisponible" };

  // Convertit en minutes et fusionne les plages contiguës éventuelles
  let ranges = matches.map(m => [ +m[1]*60 + +m[2], +m[3]*60 + +m[4] ])
                      .sort((a,b) => a[0]-b[0]);
  const merged = [];
  for (const [s,e] of ranges) {
    if (!merged.length || s > merged[merged.length-1][1]) merged.push([s,e]);
    else merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], e);
  }

  // Ouvert maintenant ?
  for (const [start, end] of merged) {
    if (currentMin >= start && currentMin < end) {
      return { status: "Ouvert", next: `Ferme à ${String(Math.floor(end/60)).padStart(2,'0')}h${String(end%60).padStart(2,'0')}` };
    }
  }

  // Prochaine ouverture aujourd'hui ?
  const nextRange = merged.find(([start]) => currentMin < start);
  if (nextRange) {
    const [start] = nextRange;
    return { status: "Fermé", next: `Ouvre à ${String(Math.floor(start/60)).padStart(2,'0')}h${String(start%60).padStart(2,'0')}` };
  }

  return { status: "Fermé", next: "Ouvre demain" };
}
