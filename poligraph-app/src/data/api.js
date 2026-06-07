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

export async function fetchDashboardVotesGroupes() {
  const res = await fetch(`${BASE_URL}/dashboard/votes/groupes`);
  if (!res.ok) throw new Error("Dashboard votes groupes error");
  return res.json();
}

export async function fetchDashboardMining() {
  const res = await fetch(`${BASE_URL}/dashboard/mining`);
  if (!res.ok) throw new Error("Dashboard mining error");
  return res.json();
}

export async function fetchSourceMetrics() {
  const res = await fetch(`${BASE_URL}/metrics/sources`);
  if (!res.ok) throw new Error("Source metrics error");
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
