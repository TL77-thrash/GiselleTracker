const STORAGE_KEY = "simple-flight-tracker.flights";
const REFRESH_INTERVAL_MS = 30000;
const OPEN_SKY_URL = "https://opensky-network.org/api/states/all";

const AIRPORTS = [
  { iata: "PHX", city: "Phoenix", lat: 33.4353, lon: -112.0078 },
  { iata: "DEN", city: "Denver", lat: 39.8561, lon: -104.6737 },
  { iata: "LAX", city: "Los Angeles", lat: 33.9416, lon: -118.4085 },
  { iata: "SFO", city: "San Francisco", lat: 37.6213, lon: -122.379 },
  { iata: "SEA", city: "Seattle", lat: 47.4502, lon: -122.3088 },
  { iata: "ORD", city: "Chicago", lat: 41.9742, lon: -87.9073 },
  { iata: "DFW", city: "Dallas", lat: 32.8998, lon: -97.0403 },
  { iata: "ATL", city: "Atlanta", lat: 33.6407, lon: -84.4277 },
  { iata: "JFK", city: "New York", lat: 40.6413, lon: -73.7781 },
  { iata: "BOS", city: "Boston", lat: 42.3656, lon: -71.0096 },
  { iata: "MIA", city: "Miami", lat: 25.7959, lon: -80.2871 },
  { iata: "LAS", city: "Las Vegas", lat: 36.084, lon: -115.1537 },
  { iata: "MSP", city: "Minneapolis", lat: 44.8848, lon: -93.2223 },
  { iata: "DTW", city: "Detroit", lat: 42.2162, lon: -83.3554 },
  { iata: "IAD", city: "Washington", lat: 38.9531, lon: -77.4565 },
];

const state = {
  flights: loadFlights(),
  selectedFlight: null,
};

const form = document.getElementById("flight-form");
const input = document.getElementById("flight-input");
const flightList = document.getElementById("flight-list");
const countBadge = document.getElementById("count-badge");
const refreshAllBtn = document.getElementById("refresh-all");
const clearAllBtn = document.getElementById("clear-all");
const sourceNote = document.getElementById("source-note");
const selectedFlightLabel = document.getElementById("selected-flight-label");
const routeCaption = document.getElementById("route-caption");
const cardTemplate = document.getElementById("flight-card-template");

const map = L.map("flight-map", { zoomControl: true }).setView([39.5, -98.35], 4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 13,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const routeLine = L.polyline([], { color: "#00e5ff", weight: 3, opacity: 0.75 }).addTo(map);
const currentMarker = L.circleMarker([39.5, -98.35], {
  radius: 7,
  color: "#6bfaa4",
  fillColor: "#6bfaa4",
  fillOpacity: 0.9,
}).addTo(map);

function loadFlights() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  return Array.isArray(saved) ? saved : [];
}

function saveFlights() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.flights));
}

function normalizeFlightNumber(raw) {
  return raw.toUpperCase().replace(/\s+/g, "").trim();
}

function formatUpdatedTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function seededValue(seed, min, max) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const ratio = Math.abs(Math.sin(hash)) % 1;
  return min + ratio * (max - min);
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * 6371 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function nearestAirport(lat, lon) {
  return AIRPORTS.reduce((best, airport) => {
    const dist = distanceKm(lat, lon, airport.lat, airport.lon);
    if (!best || dist < best.dist) {
      return { airport, dist };
    }
    return best;
  }, null).airport;
}

function projectPoint(lat, lon, headingDeg, distanceKmAhead) {
  const rad = Math.PI / 180;
  const heading = headingDeg * rad;
  const d = distanceKmAhead / 6371;
  const lat1 = lat * rad;
  const lon1 = lon * rad;

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(heading));
  const lon2 =
    lon1 +
    Math.atan2(Math.sin(heading) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return {
    lat: (lat2 * 180) / Math.PI,
    lon: ((lon2 * 180) / Math.PI + 540) % 360 - 180,
  };
}

function routeFromPosition(lat, lon, heading) {
  const origin = nearestAirport(lat, lon);
  const projected = projectPoint(lat, lon, heading || 90, 950);
  const destination = nearestAirport(projected.lat, projected.lon);
  return { origin, destination };
}

function buildSimulatedFlight(flight) {
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  const t = seconds / 100;
  const baseLat = seededValue(`${flight.number}:lat`, -55, 55);
  const baseLon = seededValue(`${flight.number}:lon`, -130, 130);

  const lat = baseLat + Math.sin(t) * 1.7;
  const lon = baseLon + Math.cos(t) * 2.3;
  const altitude = Math.round(28000 + seededValue(`${flight.number}:alt`, 0, 12000) + Math.sin(t * 1.5) * 650);
  const speed = Math.round(420 + seededValue(`${flight.number}:spd`, 0, 120) + Math.cos(t) * 10);
  const heading = Math.round((seededValue(`${flight.number}:hdg`, 0, 360) + t * 12) % 360);
  const progress = Math.round((seededValue(`${flight.number}:prg`, 5, 95) + t * 1.5) % 100);
  const route = routeFromPosition(lat, lon, heading);

  return {
    ...flight,
    status: "Estimated (simulated)",
    source: "Simulated fallback",
    lat,
    lon,
    altitude,
    speed,
    heading,
    progress,
    route,
    updatedAt: now,
  };
}

function callsignFromFlightNumber(flightNumber) {
  return flightNumber.replace(/\d.*$/, "").toUpperCase();
}

function flightNumberDigits(flightNumber) {
  const match = flightNumber.match(/\d+/);
  return match ? match[0] : "";
}

function lookupOpenSkyState(states, flightNumber) {
  const typedNoSpace = normalizeFlightNumber(flightNumber);
  const airline = callsignFromFlightNumber(typedNoSpace);
  const digits = flightNumberDigits(typedNoSpace);

  return states.find((stateRow) => {
    const callsign = (stateRow[1] || "").replace(/\s+/g, "").toUpperCase();
    if (!callsign) {
      return false;
    }

    return callsign === typedNoSpace || (callsign.startsWith(airline) && callsign.endsWith(digits));
  });
}

function buildRealFlight(flight, stateRow) {
  const lon = stateRow[5];
  const lat = stateRow[6];
  const altitudeMeters = stateRow[7] ?? stateRow[13] ?? 0;
  const speedMps = stateRow[9] ?? 0;
  const heading = Math.round(stateRow[10] ?? 0);

  if (typeof lat !== "number" || typeof lon !== "number") {
    return null;
  }

  const altitude = Math.round(altitudeMeters * 3.28084);
  const speed = Math.round(speedMps * 1.94384);
  const route = routeFromPosition(lat, lon, heading);
  const totalDistance = distanceKm(route.origin.lat, route.origin.lon, route.destination.lat, route.destination.lon);
  const coveredDistance = distanceKm(route.origin.lat, route.origin.lon, lat, lon);
  const progress = Math.max(4, Math.min(96, Math.round((coveredDistance / Math.max(1, totalDistance)) * 100)));

  return {
    ...flight,
    status: stateRow[8] ? "On ground" : "En route",
    source: "OpenSky live",
    lat,
    lon,
    altitude,
    speed,
    heading,
    progress,
    route,
    updatedAt: Date.now(),
  };
}

function addFlight(flightNumber) {
  if (state.flights.some((f) => f.number === flightNumber)) {
    return false;
  }

  state.flights.push(buildSimulatedFlight({ number: flightNumber }));
  if (!state.selectedFlight) {
    state.selectedFlight = flightNumber;
  }
  saveFlights();
  render();
  return true;
}

function removeFlight(flightNumber) {
  state.flights = state.flights.filter((f) => f.number !== flightNumber);
  if (state.selectedFlight === flightNumber) {
    state.selectedFlight = state.flights[0]?.number || null;
  }
  saveFlights();
  render();
}

function updateMap() {
  const flight = state.flights.find((f) => f.number === state.selectedFlight);

  if (!flight) {
    selectedFlightLabel.textContent = "No flight selected";
    routeCaption.textContent = "Select a flight card to see a route line.";
    routeLine.setLatLngs([]);
    currentMarker.setLatLng([39.5, -98.35]);
    map.setView([39.5, -98.35], 4);
    return;
  }

  const { origin, destination } = flight.route;
  selectedFlightLabel.textContent = `${flight.number} • ${origin.iata} → ${destination.iata}`;
  routeCaption.textContent = `${origin.city} (${origin.iata}) → ${destination.city} (${destination.iata})`;

  const latLngs = [
    [origin.lat, origin.lon],
    [flight.lat, flight.lon],
    [destination.lat, destination.lon],
  ];

  routeLine.setLatLngs(latLngs);
  currentMarker.setLatLng([flight.lat, flight.lon]);
  currentMarker.bindPopup(`${flight.number}<br>${flight.status}<br>${flight.source}`);

  const bounds = L.latLngBounds(latLngs);
  map.fitBounds(bounds.pad(0.35));
}

function render() {
  flightList.innerHTML = "";
  countBadge.textContent = `${state.flights.length} flight${state.flights.length === 1 ? "" : "s"}`;

  if (!state.flights.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No flights tracked yet. Add a flight number to begin.";
    flightList.appendChild(empty);
    updateMap();
    return;
  }

  state.flights
    .sort((a, b) => a.number.localeCompare(b.number))
    .forEach((flight) => {
      const card = cardTemplate.content.firstElementChild.cloneNode(true);

      card.querySelector(".flight-number").textContent = flight.number;
      card.querySelector(".flight-status").textContent = flight.status;
      card.querySelector(".flight-route").textContent = `${flight.route.origin.iata} → ${flight.route.destination.iata}`;
      card.querySelector(".flight-altitude").textContent = `${flight.altitude.toLocaleString()} ft`;
      card.querySelector(".flight-speed").textContent = `${flight.speed} kt`;
      card.querySelector(".flight-lat").textContent = flight.lat.toFixed(3);
      card.querySelector(".flight-lon").textContent = flight.lon.toFixed(3);
      card.querySelector(".flight-heading").textContent = `${flight.heading}°`;
      card.querySelector(".flight-source").textContent = flight.source;
      card.querySelector(".flight-updated").textContent = formatUpdatedTime(flight.updatedAt);

      const plane = card.querySelector(".plane");
      plane.style.left = `${flight.progress}%`;

      if (flight.number === state.selectedFlight) {
        card.classList.add("selected");
      }

      card.addEventListener("click", () => {
        state.selectedFlight = flight.number;
        render();
      });

      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          state.selectedFlight = flight.number;
          render();
        }
      });

      card.querySelector(".remove-btn").addEventListener("click", (event) => {
        event.stopPropagation();
        removeFlight(flight.number);
      });

      flightList.appendChild(card);
    });

  updateMap();
}

async function refreshAllFlights() {
  let usedRealData = false;
  let states = null;

  try {
    const response = await fetch(OPEN_SKY_URL);
    if (response.ok) {
      const payload = await response.json();
      states = payload.states || [];
    }
  } catch {
    states = null;
  }

  state.flights = state.flights.map((flight) => {
    if (states) {
      const matched = lookupOpenSkyState(states, flight.number);
      if (matched) {
        const realFlight = buildRealFlight(flight, matched);
        if (realFlight) {
          usedRealData = true;
          return realFlight;
        }
      }
    }

    return buildSimulatedFlight(flight);
  });

  sourceNote.textContent = usedRealData
    ? "Data source: OpenSky live for matching flights (fallback simulation for unmatched flights)."
    : "Data source: simulated fallback (no live match found yet or OpenSky unavailable).";

  saveFlights();
  render();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const normalized = normalizeFlightNumber(input.value);

  if (!normalized || !/^[A-Z0-9]{2,10}$/.test(normalized)) {
    input.setCustomValidity("Use 2-10 letters/numbers (e.g. UA1998). ");
    input.reportValidity();
    return;
  }

  input.setCustomValidity("");
  const added = addFlight(normalized);

  if (!added) {
    input.setCustomValidity("This flight is already tracked.");
    input.reportValidity();
    return;
  }

  input.value = "";
  input.focus();
  refreshAllFlights();
});

refreshAllBtn.addEventListener("click", refreshAllFlights);

clearAllBtn.addEventListener("click", () => {
  state.flights = [];
  state.selectedFlight = null;
  saveFlights();
  render();
});

if (state.flights.length) {
  state.selectedFlight = state.flights[0].number;
}

render();
refreshAllFlights();
setInterval(refreshAllFlights, REFRESH_INTERVAL_MS);
