const STORAGE_KEY = "simple-flight-tracker.flights";
const API_KEY_STORAGE = "simple-flight-tracker.aviationstack-key";
const REFRESH_INTERVAL_MS = 30000;
const OPEN_SKY_URL = "https://opensky-network.org/api/states/all";
const AVIATIONSTACK_URL = "https://api.aviationstack.com/v1/flights";

const AIRPORTS = [
  { iata: "PHX", city: "Phoenix" },
  { iata: "DEN", city: "Denver" },
  { iata: "LAX", city: "Los Angeles" },
  { iata: "SFO", city: "San Francisco" },
  { iata: "SEA", city: "Seattle" },
  { iata: "ORD", city: "Chicago" },
  { iata: "DFW", city: "Dallas" },
  { iata: "ATL", city: "Atlanta" },
  { iata: "JFK", city: "New York" },
  { iata: "BOS", city: "Boston" },
  { iata: "MIA", city: "Miami" },
  { iata: "LAS", city: "Las Vegas" },
  { iata: "MSP", city: "Minneapolis" },
  { iata: "DTW", city: "Detroit" },
  { iata: "IAD", city: "Washington" },
];

const state = {
  flights: loadFlights(),
  selectedFlight: null,
};

const form = document.getElementById("flight-form");
const input = document.getElementById("flight-input");
const apiKeyInput = document.getElementById("api-key-input");
const saveKeyBtn = document.getElementById("save-key");
const flightList = document.getElementById("flight-list");
const countBadge = document.getElementById("count-badge");
const refreshAllBtn = document.getElementById("refresh-all");
const clearAllBtn = document.getElementById("clear-all");
const sourceNote = document.getElementById("source-note");
const summaryFlight = document.getElementById("summary-flight");
const summaryStatus = document.getElementById("summary-status");
const summaryDeparture = document.getElementById("summary-departure");
const summaryArrival = document.getElementById("summary-arrival");
const cardTemplate = document.getElementById("flight-card-template");

function loadFlights() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  return Array.isArray(saved) ? saved : [];
}

function saveFlights() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.flights));
}

function loadApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || "";
}

function saveApiKey(value) {
  localStorage.setItem(API_KEY_STORAGE, value.trim());
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

function formatClock(value) {
  if (!value) {
    return "—";
  }

  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return "—";
  }

  return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatUpdatedTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function airlineFromFlightNumber(flightNumber) {
  return flightNumber.replace(/\d.*$/, "").toUpperCase();
}

function digitsFromFlightNumber(flightNumber) {
  const match = flightNumber.match(/\d+/);
  return match ? match[0] : "";
}

function randomRouteFromFlight(flightNumber) {
  const from = AIRPORTS[Math.floor(seededValue(`${flightNumber}:from`, 0, AIRPORTS.length - 0.0001))];
  const to = AIRPORTS[Math.floor(seededValue(`${flightNumber}:to`, 0, AIRPORTS.length - 0.0001))];
  if (from.iata === to.iata) {
    return { departure: from, arrival: AIRPORTS[(AIRPORTS.indexOf(from) + 1) % AIRPORTS.length] };
  }
  return { departure: from, arrival: to };
}

function simulatedSchedule(flightNumber) {
  const now = Date.now();
  const route = randomRouteFromFlight(flightNumber);
  const departOffsetMin = Math.floor(seededValue(`${flightNumber}:depart`, -90, 40));
  const durationMin = Math.floor(seededValue(`${flightNumber}:dur`, 80, 260));
  const departureTime = now + departOffsetMin * 60000;
  const arrivalTime = departureTime + durationMin * 60000;

  return {
    route,
    departureTime,
    arrivalTime,
    status: now < departureTime ? "Scheduled" : now > arrivalTime ? "Landed" : "In Air",
  };
}

function buildSimulatedFlight(flight) {
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  const t = seconds / 100;
  const altitude = Math.round(28000 + seededValue(`${flight.number}:alt`, 0, 12000) + Math.sin(t * 1.5) * 650);
  const speed = Math.round(420 + seededValue(`${flight.number}:spd`, 0, 120) + Math.cos(t) * 10);
  const heading = Math.round((seededValue(`${flight.number}:hdg`, 0, 360) + t * 12) % 360);
  const progress = Math.round((seededValue(`${flight.number}:prg`, 5, 95) + t * 1.5) % 100);
  const schedule = simulatedSchedule(flight.number);

  return {
    ...flight,
    status: `${schedule.status} (estimated)`,
    source: "Estimated fallback",
    route: schedule.route,
    departureTime: schedule.departureTime,
    arrivalTime: schedule.arrivalTime,
    altitude,
    speed,
    heading,
    progress,
    updatedAt: now,
  };
}

function lookupOpenSkyState(states, flightNumber) {
  const typedNoSpace = normalizeFlightNumber(flightNumber);
  const airline = airlineFromFlightNumber(typedNoSpace);
  const digits = digitsFromFlightNumber(typedNoSpace);

  return states.find((stateRow) => {
    const callsign = (stateRow[1] || "").replace(/\s+/g, "").toUpperCase();
    if (!callsign) {
      return false;
    }

    return callsign === typedNoSpace || (callsign.startsWith(airline) && callsign.endsWith(digits));
  });
}

function applyOpenSkyToFlight(base, stateRow) {
  if (!stateRow) {
    return base;
  }

  const altitudeMeters = stateRow[7] ?? stateRow[13] ?? 0;
  const speedMps = stateRow[9] ?? 0;
  const heading = Math.round(stateRow[10] ?? base.heading ?? 0);

  return {
    ...base,
    status: stateRow[8] ? "On ground" : "In Air",
    source: base.source.includes("AviationStack") ? base.source : "OpenSky + estimated schedule",
    altitude: Math.round(altitudeMeters * 3.28084),
    speed: Math.round(speedMps * 1.94384),
    heading,
    updatedAt: Date.now(),
  };
}

function iataToRouteAirport(iata) {
  const match = AIRPORTS.find((a) => a.iata === iata);
  return match || { iata: iata || "UNK", city: iata || "Unknown" };
}

function parseAviationStackFlight(base, item) {
  const depIata = item?.departure?.iata;
  const arrIata = item?.arrival?.iata;
  const depCity = item?.departure?.airport || item?.departure?.timezone || iataToRouteAirport(depIata).city;
  const arrCity = item?.arrival?.airport || item?.arrival?.timezone || iataToRouteAirport(arrIata).city;
  const route = {
    departure: { iata: depIata || "UNK", city: depCity || "Unknown" },
    arrival: { iata: arrIata || "UNK", city: arrCity || "Unknown" },
  };

  return {
    ...base,
    status: item?.flight_status ? item.flight_status.replace(/_/g, " ") : base.status,
    source: "AviationStack schedule + OpenSky/estimated telemetry",
    route,
    departureTime: item?.departure?.estimated || item?.departure?.scheduled || item?.departure?.actual || base.departureTime,
    arrivalTime: item?.arrival?.estimated || item?.arrival?.scheduled || item?.arrival?.actual || base.arrivalTime,
  };
}

async function fetchAviationStackFlight(flightNumber, apiKey) {
  const url = new URL(AVIATIONSTACK_URL);
  url.searchParams.set("access_key", apiKey);
  url.searchParams.set("flight_iata", flightNumber);

  const response = await fetch(url.toString());
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const first = payload?.data?.[0];
  return first || null;
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

function updateSummaryBar() {
  const flight = state.flights.find((f) => f.number === state.selectedFlight);

  if (!flight) {
    summaryFlight.textContent = "No flight selected";
    summaryStatus.textContent = "—";
    summaryDeparture.textContent = "—";
    summaryArrival.textContent = "—";
    return;
  }

  summaryFlight.textContent = flight.number;
  summaryStatus.textContent = flight.status;
  summaryDeparture.textContent = `${flight.route.departure.city} (${flight.route.departure.iata}) • ${formatClock(flight.departureTime)}`;
  summaryArrival.textContent = `${flight.route.arrival.city} (${flight.route.arrival.iata}) • ${formatClock(flight.arrivalTime)}`;
}

function render() {
  flightList.innerHTML = "";
  countBadge.textContent = `${state.flights.length} flight${state.flights.length === 1 ? "" : "s"}`;

  if (!state.flights.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No flights tracked yet. Add a flight number to begin.";
    flightList.appendChild(empty);
    updateSummaryBar();
    return;
  }

  state.flights
    .sort((a, b) => a.number.localeCompare(b.number))
    .forEach((flight) => {
      const card = cardTemplate.content.firstElementChild.cloneNode(true);

      card.querySelector(".flight-number").textContent = flight.number;
      card.querySelector(".flight-status").textContent = flight.status;
      card.querySelector(".flight-route").textContent = `${flight.route.departure.iata} → ${flight.route.arrival.iata}`;
      card.querySelector(".flight-departure").textContent = `${flight.route.departure.city} • ${formatClock(flight.departureTime)}`;
      card.querySelector(".flight-arrival").textContent = `${flight.route.arrival.city} • ${formatClock(flight.arrivalTime)}`;
      card.querySelector(".flight-altitude").textContent = `${flight.altitude.toLocaleString()} ft`;
      card.querySelector(".flight-speed").textContent = `${flight.speed} kt`;
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

  updateSummaryBar();
}

async function refreshAllFlights() {
  const apiKey = loadApiKey();
  let states = null;
  let usedOpenSky = false;
  let usedAviationStack = false;

  try {
    const response = await fetch(OPEN_SKY_URL);
    if (response.ok) {
      const payload = await response.json();
      states = payload.states || [];
    }
  } catch {
    states = null;
  }

  state.flights = await Promise.all(
    state.flights.map(async (flight) => {
      let updated = buildSimulatedFlight(flight);

      if (apiKey) {
        try {
          const aviationData = await fetchAviationStackFlight(flight.number, apiKey);
          if (aviationData) {
            updated = parseAviationStackFlight(updated, aviationData);
            usedAviationStack = true;
          }
        } catch {
          // keep fallback data
        }
      }

      if (states) {
        const matched = lookupOpenSkyState(states, flight.number);
        if (matched) {
          updated = applyOpenSkyToFlight(updated, matched);
          usedOpenSky = true;
        }
      }

      return updated;
    }),
  );

  if (usedAviationStack && usedOpenSky) {
    sourceNote.textContent =
      "Data source: AviationStack for departure/arrival schedule + OpenSky for live in-flight telemetry.";
  } else if (usedAviationStack) {
    sourceNote.textContent = "Data source: AviationStack schedule + estimated telemetry.";
  } else if (usedOpenSky) {
    sourceNote.textContent = "Data source: OpenSky live telemetry + estimated schedule.";
  } else {
    sourceNote.textContent = "Data source: estimated fallback (API blocked/unavailable or no match found).";
  }

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

saveKeyBtn.addEventListener("click", () => {
  saveApiKey(apiKeyInput.value);
  sourceNote.textContent = "API key saved locally. Refreshing now...";
  refreshAllFlights();
});

refreshAllBtn.addEventListener("click", refreshAllFlights);

clearAllBtn.addEventListener("click", () => {
  state.flights = [];
  state.selectedFlight = null;
  saveFlights();
  render();
});

apiKeyInput.value = loadApiKey();

if (state.flights.length) {
  state.selectedFlight = state.flights[0].number;
}

render();
refreshAllFlights();
setInterval(refreshAllFlights, REFRESH_INTERVAL_MS);
