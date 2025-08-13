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

  // Parse les horaires d'une agence et renvoie {status, next}
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
    // Récupère la ligne du jour courant: "LU : 07:45-12:00/12:00-15:30" ou "LU : Fermé"
    const line = lines.find((l) => l.startsWith(jourActuel)) || "";

    // Normalise pour gérer "Fermé"/"Ferme"
    const lineNorm = line.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/ferme/i.test(lineNorm)) return { status: "Fermé", next: "Ouvre demain" };

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

    // Prochaine ouverture aujourd'hui ?
    const nextRange = merged.find(([start]) => currentMin < start);
    if (nextRange) {
      const [start] = nextRange;
      return {
        status: "Fermé",
        next: `Ouvre à ${String(Math.floor(start / 60)).padStart(2, "0")}h${String(start % 60).padStart(2, "0")}`,
      };
    }

    // Sinon, ce sera demain
    return { status: "Fermé", next: "Ouvre demain" };
  }

  // --- Données + UI ---
  const agences = [];
  const listings = document.getElementById("listings");
  const searchInput = document.getElementById("search");

  fetch(
    "https://services6.arcgis.com/k3ZIRnRpeM4Ht4fG/arcgis/rest/services/Agences_opendata/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson"
  )
    .then((response) => response.json())
    .then((data) => {
      data.features.forEach((feature) => {
        const agence = {
          lat: feature.geometry.coordinates[1],
          lng: feature.geometry.coordinates[0],
          nom: feature.properties.TEXTE,
          adresse: feature.properties.ADRESSE,
          codePostal: feature.properties.CODE_POSTAL,
          ville: feature.properties.VILLE,
          telephone: feature.properties.TEL,
          fax: feature.properties.FAX,
          // On garde le <br> pour le parsing + affichage
          horaires: (feature.properties.HORAIRE || "").replace(/\n/g, "<br>"),
        };

        // Statut en fonction des horaires (heure NC)
        const { status, next } = parseHoraires(agence.horaires);
        const statusColor = status === "Ouvert" ? "green" : "rgb(248, 59, 59)";

        // Tableau d’horaires formaté
        const horairesFormattes =
          `<table style="width:100%; border-collapse: collapse;">` +
          `<tr><th style="text-align:left;border:1px solid #ccc;padding:5px;">Jour</th><th style="text-align:left;border:1px solid #ccc;padding:5px;">Horaires</th></tr>` +
          agence.horaires
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

        // Marqueur + popup
        const marker = L.marker([agence.lat, agence.lng]).addTo(mymap).bindPopup(`
          <div>
            <h2 style="margin-bottom: 5px;">Agence de ${agence.nom}</h2>
            <p>
              <b>Adresse :</b> ${agence.adresse}<br>
              <b>Code Postal :</b> ${agence.codePostal} - ${agence.ville}<br>
              <b>Téléphone :</b> ${agence.telephone || "-"}<br>
              <b>Fax :</b> ${agence.fax || "-"}
            </p>
            ${horairesFormattes}
            <p><b>Status :</b> <span style="color:${statusColor};">${status}</span></p>
            <p><b>Prochainement :</b> ${next}</p>
          </div>
        `);

        agences.push({ ...agence, marker, status, next });
      });

      updateListings();
    })
    .catch((error) => console.error("Erreur lors du chargement des agences :", error));

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
          mymap.setView([agence.lat, agence.lng], 20);
          agence.marker.openPopup();
        });
        listings.appendChild(item);
      });
  }

  searchInput.addEventListener("input", updateListings);
});
