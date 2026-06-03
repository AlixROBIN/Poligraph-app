const BASE_URL = (process.env.REACT_APP_API_URL || "http://localhost:8000") + "/api";

export async function fetchJSON(path) {
  const url = path.startsWith("http") ? path : `${BASE_URL.replace(/\/api$/, "")}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function fetchData(limit = 100, offset = 0) {
  const res = await fetch(`${BASE_URL}/data?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error("API data error");
  const json = await res.json();
  return json.data ?? json;
}

export async function fetchMetrics() {
  const res = await fetch(`${BASE_URL}/metrics`);
  if (!res.ok) throw new Error("API metrics error");
  return res.json();
}

export async function fetchThemes() {
  const res = await fetch(`${BASE_URL}/themes`);
  if (!res.ok) throw new Error("API themes error");
  return res.json();
}

export async function fetchSearchFilters() {
  const res = await fetch(`${BASE_URL}/search/filters`);
  if (!res.ok) throw new Error("Filters error");
  return res.json();
}

export async function fetchDashboardScandales() {
  const res = await fetch(`${BASE_URL}/dashboard/scandales`);
  if (!res.ok) throw new Error("Dashboard scandales error");
  return res.json();
}

export async function fetchDashboardVotes() {
  const res = await fetch(`${BASE_URL}/dashboard/votes`);
  if (!res.ok) throw new Error("Dashboard votes error");
  return res.json();
}

export async function fetchDashboardMining() {
  const res = await fetch(`${BASE_URL}/dashboard/mining`);
  if (!res.ok) throw new Error("Dashboard mining error");
  return res.json();
}

export async function predictVote({ title, annee = 2025, legislature = 17,
  use_live_sentiment = true }) {
  const res = await fetch(`${BASE_URL}/predict/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, annee, legislature, use_live_sentiment }),
  });
  if (!res.ok) throw new Error("Predict vote error");
  return res.json();
}

export async function predictScandale({ party = "RN", annee = 2024,
  institution = "Assemblée nationale", description = "",
  status = null, top_n = 5, use_live_sentiment = true }) {
  const res = await fetch(`${BASE_URL}/predict/scandale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ party, annee, institution, description, status, top_n, use_live_sentiment }),
  });
  if (!res.ok) throw new Error("Predict scandale error");
  return res.json();
}

export async function predictPolitician({ category = "CORRUPTION", party = "RN",
  status = "ENQUETE_PRELIMINAIRE", top_n = 5 }) {
  const res = await fetch(`${BASE_URL}/predict/politician`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, party, status, top_n }),
  });
  if (!res.ok) throw new Error("Predict politician error");
  return res.json();
}

export async function sendChat({ message, history = [] }) {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Chat error ${res.status}`);
  }
  return res.json();
}
