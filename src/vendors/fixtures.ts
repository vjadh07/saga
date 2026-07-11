// fixed data so every demo run and test sees the identical world
export const FLIGHTS = [
  { id: "F100", from: "PHX", to: "SFO", depart: "09:15", arrive: "11:05", airline: "Saguaro Air", price: 129 },
  { id: "F200", from: "PHX", to: "SFO", depart: "13:40", arrive: "15:25", airline: "Camelback Jet", price: 189 },
  { id: "F300", from: "PHX", to: "SFO", depart: "18:20", arrive: "20:10", airline: "Saguaro Air", price: 240 },
];

export const HOTELS = [
  { id: "H100", name: "Mission Bay Inn", city: "San Francisco", nightly: 145 },
  { id: "H200", name: "Fog Harbor Hotel", city: "San Francisco", nightly: 210 },
  { id: "H300", name: "Presidio Lodge", city: "San Francisco", nightly: 320 },
];

export const SEARCH_FIXTURES: Record<string, unknown[]> = {
  flights: FLIGHTS,
  hotels: HOTELS,
};
