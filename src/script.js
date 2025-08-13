document.addEventListener("DOMContentLoaded", () => {
    var mymap = L.map("mapid").setView([-21.0598, 164.8626], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
    }).addTo(mymap);

    // Fonction pour normaliser les chaînes (mettre en minuscule et enlever les accents)
    function normalizeString(str) {
        return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    function parseHoraires(horaires) {
        let jours = ["DI", "LU", "MA", "ME", "JE", "VE", "SA"];
        let today = new Date();
        let jourActuel = jours[today.getDay()];
        let heureActuelle = today.getHours() * 60 + today.getMinutes();
        
        let match = horaires.match(new RegExp(jourActuel + " : ([0-9: /-]+)"));
        if (!match) return { status: "Fermé", next: "Horaire indisponible" };

        let plagesHoraires = match[1].split("/").map(plage => plage.split("-").map(h => {
            let [hStr, mStr] = h.split(":").map(Number);
            return hStr * 60 + mStr;
        }));

        for (let i = 0; i < plagesHoraires.length; i++) {
            let [debut, fin] = plagesHoraires[i];

            // Si l'heure de fin de la période courante est égale à l'heure de début de la suivante,
            // cela signifie que l'agence est ouverte en continu
            if (i < plagesHoraires.length - 1 && fin === plagesHoraires[i + 1][0]) {
                // L'agence est ouverte en continu, donc nous ignorons la fermeture ici
                return { status: "Ouvert", next: `Ferme à ${Math.floor(plagesHoraires[i + 1][1] / 60)}h${String(plagesHoraires[i + 1][1] % 60).padStart(2, '0')}` };
            }

            if (heureActuelle >= debut && heureActuelle < fin) {
                return { status: "Ouvert", next: `Ferme à ${Math.floor(fin / 60)}h${String(fin % 60).padStart(2, '0')}` };
            }
        }

        let prochaineOuverture = plagesHoraires.find(([debut]) => heureActuelle < debut);
        if (prochaineOuverture) {
            return { status: "Fermé", next: `Ouvre à ${Math.floor(prochaineOuverture[0] / 60)}h${String(prochaineOuverture[0] % 60).padStart(2, '0')}` };
        }

        return { status: "Fermé", next: "Ouvre demain" };
    }

    let agences = [];
    let listings = document.getElementById("listings");
    let searchInput = document.getElementById("search");

    fetch("https://services6.arcgis.com/k3ZIRnRpeM4Ht4fG/arcgis/rest/services/Agences_opendata/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson")
        .then(response => response.json())
        .then(data => {
            data.features.forEach(feature => {
                let agence = {
                    lat: feature.geometry.coordinates[1],
                    lng: feature.geometry.coordinates[0],
                    nom: feature.properties.TEXTE,
                    adresse: feature.properties.ADRESSE,
                    codePostal: feature.properties.CODE_POSTAL,
                    ville: feature.properties.VILLE,
                    telephone: feature.properties.TEL,
                    fax: feature.properties.FAX,
                    horaires: feature.properties.HORAIRE.replace(/\n/g, "<br>"),
                };

                // Applique la fonction de parsing des horaires pour chaque agence
                let { status, next } = parseHoraires(agence.horaires);
                let statusColor = status === "Ouvert" ? "green" : "rgb(248, 59, 59)";

                // Génère le tableau des horaires
                let horairesFormattes = `<table style='width:100%; border-collapse: collapse;'>
                    <tr><th>Jour</th><th>Horaires</th></tr>` + 
                    agence.horaires.split("<br>").map(line => {
                        let [jour, heures] = line.split(" : ");
                        return `<tr><td style='border: 1px solid #ccc; padding: 5px;'>${jour}</td>
                                    <td style='border: 1px solid #ccc; padding: 5px;'>${heures || "Fermé"}</td></tr>`;
                    }).join("") + `</table>`;

                // Crée le marqueur et l'ajoute à la carte
                let marker = L.marker([agence.lat, agence.lng])
                    .addTo(mymap)
                    .bindPopup(`
                        <div>
                            <h2 style="margin-bottom: 5px;">Agence de ${agence.nom}</h2>
                            <p><b>Adresse :</b> ${agence.adresse}<br>
                            <b>Code Postal :</b> ${agence.codePostal} - ${agence.ville}<br>
                            <b>Téléphone :</b> ${agence.telephone}<br>
                            <b>Fax :</b> ${agence.fax}</p>
                            ${horairesFormattes}
                            <p><b>Status :</b> <span style="color: ${statusColor};">${status}</span></p>
                            <p><b>Prochainement :</b> ${next}</p>
                        </div>`);

                agences.push({ ...agence, marker, status, next });
            });

            updateListings();
        })
        .catch(error => console.error("Erreur lors du chargement des agences :", error));

    // Mise à jour de la liste affichée en fonction du texte de recherche
    function updateListings() {
        listings.innerHTML = "";
        let searchText = normalizeString(searchInput.value); // Normalisation de la chaîne de recherche

        agences.filter(agence =>
            normalizeString(agence.nom).includes(searchText) ||
            normalizeString(agence.ville).includes(searchText) ||
            normalizeString(agence.adresse).includes(searchText)
        ).forEach(agence => {
            let listingItem = document.createElement("div");
            listingItem.classList.add("listing-item");
            listingItem.innerHTML = `
                <div class="station-info">
                    <span class="station-name">${agence.nom}</span>
                    <span class="station-detail">${agence.ville}</span>
                    <span class="station-detail">${agence.adresse}</span>
                    <p class="station-detail" style="color: ${agence.status === "Ouvert" ? "green" : "rgb(248, 59, 59)"};">${agence.status}  
                    <span class="station-detail">• ${agence.next}</span></p>
                </div>`;

            listingItem.addEventListener("click", () => {
                mymap.setView([agence.lat, agence.lng], 20);
                agence.marker.openPopup();
            });

            listings.appendChild(listingItem);
        });
    }

    searchInput.addEventListener("input", updateListings);
});
