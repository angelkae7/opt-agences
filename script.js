document.addEventListener("DOMContentLoaded", () => {
  // --- Carte Leaflet ---
  const mymap = L.map("mapid").setView([-21.0598, 164.8626], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(mymap);

  // --- Utils ---
  function normalizeString(str) {
    return (str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  // Heure actuelle en Pacific/Noumea (en minutes)
  function minutesNowNC() {
    const parts = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Pacific/Noumea",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date());
    const h = +parts.find((p) => p.type === "hour").value;
    const m = +parts.find((p) => p.type === "minute").value;
    return h * 60 + m;
  }

  // Convertit le tableau horaires ES → lignes "LU : 07:45-15:30[/12:30-17:00]"
  function horairesArrayToLines(horaires = []) {
    const order = ["LU", "MA", "ME", "JE", "VE", "SA", "DI"];
    const label = { LU: "LU", MA: "MA", ME: "ME", JE: "JE", VE: "VE", SA: "SA", DI: "DI" };

    // Map rapide par code jour
    const byJour = Object.fromEntries(order.map(j => [j, null]));
    for (const h of horaires) {
      if (byJour.hasOwnProperty(h.jour)) byJour[h.jour] = h;
    }

    // Formate une journée
    function formatJour(h) {
      if (!h) return "Fermé";
      const { horaireAm1, horaireAm2, horairePm1, horairePm2 } = h;
      const hasAm = horaireAm1 && horaireAm2;
      const hasPm = horairePm1 && horairePm2;

      // Cas le plus fréquent : sans coupure (Am1 → Pm2)
      if (horaireAm1 && horairePm2 && !horaireAm2 && !horairePm1) {
        return `${horaireAm1}-${horairePm2}`;
      }
      // Matin + après-midi
      if (hasAm && hasPm) {
        return `${horaireAm1}-${horaireAm2}/${horairePm1}-${horairePm2}`;
      }
      // Un seul créneau
      if (hasAm) return `${horaireAm1}-${horaireAm2}`;
      if (hasPm) return `${horairePm1}-${horairePm2}`;

      return "Fermé";
    }

    return order.map(j => `${label[j]} : ${formatJour(byJour[j])}`).join("<br>");
  }

// Parse les horaires (au format lignes "XX : hh:mm-hh:mm[/…]") et renvoie {status, next}
function parseHoraires(horaires) {
  const jours = ["DI", "LU", "MA", "ME", "JE", "VE", "SA"];
  const now = new Date();

  // Jour actuel (ex: "LU", "MA", ...)
  const weekdayShort = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Pacific/Noumea",
    weekday: "short",
  })
    .format(now) // ex. "lun."
    .replace(".", "")
    .toUpperCase()
    .slice(0, 2);
  const jourActuel = jours.includes(weekdayShort) ? weekdayShort : jours[now.getDay()];

  const currentMin = minutesNowNC();

  // Lignes d'horaires (séparées par <br>)
  const lines = (horaires || "").split("<br>");
  // Ligne du jour courant
  const line = lines.find((l) => l.startsWith(jourActuel)) || "";
  const lineNorm = line.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Cas : agence fermée aujourd’hui
  if (/ferme/i.test(lineNorm)) {
    // chercher le prochain jour ouvert
    const idxJour = jours.indexOf(jourActuel);
    for (let i = 1; i <= 6; i++) {
      const prochainJour = jours[(idxJour + i) % 7];
      const prochainLine = lines.find((l) => l.startsWith(prochainJour)) || "";
      const prochainNorm = prochainLine.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (!/ferme/i.test(prochainNorm) && /\d{2}:\d{2}-\d{2}:\d{2}/.test(prochainNorm)) {
        return { status: "Fermé", next: `Ouvre ${prochainJour}` };
      }
    }
    return { status: "Fermé", next: "Horaires indisponibles" };
  }

  // Extrait toutes les plages HH:MM-HH:MM
  const matches = [...line.matchAll(/\b(\d{2}):(\d{2})-(\d{2}):(\d{2})\b/g)];
  if (matches.length === 0) return { status: "Fermé", next: "Horaire indisponible" };

  // Convertit en minutes et fusionne les plages contiguës/chevauchantes
  let ranges = matches
    .map((m) => [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]])
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [s, e] of ranges) {
    if (!merged.length || s > merged[merged.length - 1][1]) {
      merged.push([s, e]);
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    }
  }

  // Ouvert maintenant ?
  for (const [start, end] of merged) {
    if (currentMin >= start && currentMin < end) {
      return {
        status: "Ouvert",
        next: `Ferme à ${String(Math.floor(end / 60)).padStart(2, "0")}h${String(end % 60).padStart(2, "0")}`,
      };
    }
  }

  // Prochaine ouverture aujourd’hui ?
  const nextRange = merged.find(([start]) => currentMin < start);
  if (nextRange) {
    const [start] = nextRange;
    return {
      status: "Fermé",
      next: `Ouvre à ${String(Math.floor(start / 60)).padStart(2, "0")}h${String(start % 60).padStart(2, "0")}`,
    };
  }

  // Sinon, chercher le prochain jour
  const idxJour = jours.indexOf(jourActuel);
  for (let i = 1; i <= 6; i++) {
    const prochainJour = jours[(idxJour + i) % 7];
    const prochainLine = lines.find((l) => l.startsWith(prochainJour)) || "";
    const prochainNorm = prochainLine.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!/ferme/i.test(prochainNorm) && /\d{2}:\d{2}-\d{2}:\d{2}/.test(prochainNorm)) {
      return { status: "Fermé", next: `Ouvre ${prochainJour}` };
    }
  }

  return { status: "Fermé", next: "Horaires indisponibles" };
}


  // Sélectionne le téléphone principal depuis contacts[]
  function pickPhone(contacts = []) {
    const tels = contacts.filter(c => c.typeContact === "TELEPHONE");
    // Priorité aux libellés d'accueil/AMS, sinon le premier
    return (
      tels.find(t => /AMS|ACCUEIL|STANDARD/i.test(t.description || ""))?.valeur ||
      tels[0]?.valeur ||
      ""
    );
  }

  function pickFax(contacts = []) {
    return contacts.find(c => c.typeContact === "FAX")?.valeur || "";
  }

  function pickEmail(contacts = []) {
    return contacts.find(c => c.typeContact === "EMAIL")?.valeur || "";
  }

  // --- Données + UI ---
  const agences = [];
  const listings = document.getElementById("listings");
  const searchInput = document.getElementById("search");

  // ⚠️ CORS: l’API open-data accepte les GET; on utilise la syntaxe q= et size=
  const ES_URL =
  "https://open-data.opt.nc/agences/_search?q=(type:AGENCE%20OR%20type:ANNEXE%20OR%20type:CTC%20OR%20type:CDC)%20AND%20NOT%20hiddenOptNc:true&size=1000";

// const ES_URL ="https://open-data.opt.nc/agences/_search?q=*:*&size=1000";

  fetch(ES_URL)
  .then((r) => r.json())
  .then((json) => {
    const hits = (json.hits && json.hits.hits) || [];
    
    hits.forEach((hit) => {
      const s = hit._source || {};
      if (!["AGENCE", "ANNEXE", "CTC", "CDC"].includes(s.type) || s.hiddenOptNc === true) return;

      console.log("Type:", s.type, "Designation:", s.designation);
        // Coordonnées
        const lat = s.position?.lat;
        const lng = s.position?.lon;
        if (typeof lat !== "number" || typeof lng !== "number") return;

        // Nom / adresse / ville
        const nom = s.designation || ""; // ex: "Agence de LIFOU WE"
        const adresse = s.pointAdresse || "";
        const codePostal = s.codePostal || s.codePostalRefloc || "";
        const ville = s.localiteRefloc || s.localite || "";

        // Contacts
        const telephone = pickPhone(s.contacts);
        const fax = pickFax(s.contacts);
        const email = pickEmail(s.contacts);

        // Horaires -> lignes "<br>" pour réutiliser ta logique existante
        const horairesLignes = horairesArrayToLines(s.horaires || []);
        const { status, next } = parseHoraires(horairesLignes);
        const statusColor = status === "Ouvert" ? "green" : "rgb(248, 59, 59)";

        // Tableau d’horaires formaté
        const horairesFormattes =
          `<table style="width:100%; border-collapse: collapse;">` +
          `<tr><th style="text-align:left;border:1px solid #ccc;padding:5px;">Jour</th><th style="text-align:left;border:1px solid #ccc;padding:5px;">Horaires</th></tr>` +
          horairesLignes
            .split("<br>")
            .map((line) => {
              const [jour, heures] = line.split(" : ");
              return `<tr>
                  <td style="border:1px solid #ccc;padding:5px;">${jour || ""}</td>
                  <td style="border:1px solid #ccc;padding:5px;">${heures || "Fermé"}</td>
                </tr>`;
            })
            .join("") +
          `</table>`;

        const marker = L.marker([lat, lng])
          .addTo(mymap)
          .bindPopup(`
            <div>
              <h2 style="margin-bottom: 5px;">${nom}</h2>
              <p>
                <b>Adresse :</b> ${adresse}<br>
                <b>Code Postal :</b> ${codePostal} - ${ville}<br>
                <b>Téléphone :</b> ${telephone || "-"}<br>
                <b>Fax :</b> ${fax || "-"}<br>
                <b>Email :</b> ${email || "-"}<br>
                <b>Accessibilité :</b> ${s.accesHandicapes ? "♿ Oui" : "Non"}
              </p>
              ${horairesFormattes}
              <p><b>Status :</b> <span style="color:${statusColor};">${status}</span></p>
              <p><b>Prochainement :</b> ${next}</p>
            </div>
          `);

        agences.push({
          lat,
          lng,
          nom,
          adresse,
          codePostal,
          ville,
          telephone,
          fax,
          email,
          horaires: horairesLignes, // on garde le même nom de champ pour ta recherche/affichage
          marker,
          status,
          next,
        });
      });

      updateListings();
    })
    .catch((error) => console.error("Erreur lors du chargement des agences (ES):", error));

  // MAJ de la liste affichée (filtre recherche)
  function updateListings() {
    listings.innerHTML = "";
    const searchText = normalizeString(searchInput.value);

    agences
      .filter(
        (agence) =>
          normalizeString(agence.nom).includes(searchText) ||
          normalizeString(agence.ville).includes(searchText) ||
          normalizeString(agence.adresse).includes(searchText)
      )
      .forEach((agence) => {
        const item = document.createElement("div");
        item.classList.add("listing-item");
        item.innerHTML = `
          <div class="station-info">
            <span class="station-name">${agence.nom}</span>
            <span class="station-detail">${agence.ville}</span>
            <span class="station-detail">${agence.adresse}</span>
            <p class="station-detail" style="color:${agence.status === "Ouvert" ? "green" : "rgb(248, 59, 59)"};">
              ${agence.status}
              <span class="station-detail">• ${agence.next}</span>
            </p>
          </div>
        `;
        item.addEventListener("click", () => {
          mymap.setView([agence.lat, agence.lng], 19);
          agence.marker.openPopup();
        });
        listings.appendChild(item);
      });
  }

  searchInput.addEventListener("input", updateListings);
});
