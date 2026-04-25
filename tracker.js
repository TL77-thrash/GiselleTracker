const STORAGE_KEY = "simple-flight-tracker.flights";
const REFRESH_INTERVAL_MS = 15000;

const state = {
  flights: loadFlights(),
};

const form = document.getElementById("flight-form");
const input = document.getElementById("flight-input");
const flightList = document.getElementById("flight-list");
const countBadge = document.getElementById("count-badge");
const refreshAllBtn = document.getElementById("refresh-all");
const clearAllBtn = document.getElementById("clear-all");
const cardTemplate = document.getElementById("flight-card-template");

function loadFlights() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveFlights() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.flights));
}

function normalizeFlightNumber(raw) {
  return raw.toUpperCase().replace(/\s+/g, "").trim();
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

function createOrUpdateFlightData(flight) {
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  const t = seconds / 100;
  const baseLat = seededValue(`${flight.number}:lat`, -60, 60);
  const baseLon = seededValue(`${flight.number}:lon`, -140, 140);

  const lat = baseLat + Math.sin(t) * 1.8;
  const lon = baseLon + Math.cos(t) * 2.4;
  const altitude = Math.round(28000 + seededValue(`${flight.number}:alt`, 0, 12000) + Math.sin(t * 1.5) * 800);
  const speed = Math.round(420 + seededValue(`${flight.number}:spd`, 0, 120) + Math.cos(t) * 10);
  const heading = Math.round((seededValue(`${flight.number}:hdg`, 0, 360) + t * 12) % 360);
  const progress = Math.round((seededValue(`${flight.number}:prg`, 5, 95) + t * 1.5) % 100);

  return {
    ...flight,
    status: altitude > 1000 ? "En route" : "On ground",
    lat,
    lon,
    altitude,
    speed,
    heading,
    progress,
    updatedAt: now,
  };
}

function addFlight(flightNumber) {
  if (state.flights.some((f) => f.number === flightNumber)) {
    return false;
  }

  state.flights.push(createOrUpdateFlightData({ number: flightNumber }));
  saveFlights();
  render();
  return true;
}

function removeFlight(flightNumber) {
  state.flights = state.flights.filter((f) => f.number !== flightNumber);
  saveFlights();
  render();
}

function refreshAllFlights() {
  state.flights = state.flights.map(createOrUpdateFlightData);
  saveFlights();
  render();
}

function formatUpdatedTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function render() {
  flightList.innerHTML = "";
  countBadge.textContent = `${state.flights.length} flight${state.flights.length === 1 ? "" : "s"}`;

  if (!state.flights.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No flights tracked yet. Add a flight number to begin.";
    flightList.appendChild(empty);
    return;
  }

  state.flights
    .sort((a, b) => a.number.localeCompare(b.number))
    .forEach((flight) => {
      const card = cardTemplate.content.firstElementChild.cloneNode(true);

      card.querySelector(".flight-number").textContent = flight.number;
      card.querySelector(".flight-status").textContent = flight.status;
      card.querySelector(".flight-altitude").textContent = `${flight.altitude.toLocaleString()} ft`;
      card.querySelector(".flight-speed").textContent = `${flight.speed} kt`;
      card.querySelector(".flight-lat").textContent = flight.lat.toFixed(3);
      card.querySelector(".flight-lon").textContent = flight.lon.toFixed(3);
      card.querySelector(".flight-heading").textContent = `${flight.heading}°`;
      card.querySelector(".flight-updated").textContent = formatUpdatedTime(flight.updatedAt);

      const plane = card.querySelector(".plane");
      plane.style.left = `${flight.progress}%`;

      card.querySelector(".remove-btn").addEventListener("click", () => removeFlight(flight.number));
      flightList.appendChild(card);
    });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const normalized = normalizeFlightNumber(input.value);

  if (!normalized || !/^[A-Z0-9]{2,10}$/.test(normalized)) {
    input.setCustomValidity("Use 2-10 letters/numbers (e.g. AA100). ");
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
});

refreshAllBtn.addEventListener("click", refreshAllFlights);

clearAllBtn.addEventListener("click", () => {
  state.flights = [];
  saveFlights();
  render();
});

// Refresh derived data on startup and in regular intervals.
refreshAllFlights();
setInterval(refreshAllFlights, REFRESH_INTERVAL_MS);
