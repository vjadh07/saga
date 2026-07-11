// Tool handlers the agent calls. Every side effect goes through the saga
// engine; searches are read-only and hit the vendor directly.
import type { Receipt, Saga } from "../core/saga.js";
import type { EventType } from "../ledger/types.js";

export interface TripContext {
  saga: Saga;
  sagaId: string;
  vendorBase: string;
}

export interface Flight {
  id: string;
  from: string;
  to: string;
  depart: string;
  arrive: string;
  airline: string;
  price: number;
}

export interface Hotel {
  id: string;
  name: string;
  city: string;
  nightly: number;
}

export interface ActionResult {
  actionId: string;
  state: EventType;
}

async function search<T>(ctx: TripContext, vendor: string, query: Record<string, string>): Promise<T[]> {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${ctx.vendorBase}/${vendor}/search?${qs}`);
  if (!res.ok) throw new Error(`${vendor} search answered ${res.status}`);
  return (await res.json()) as T[];
}

async function transact(
  ctx: TripContext,
  type: string,
  vendor: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const staged = ctx.saga.stage({ sagaId: ctx.sagaId, type, vendor, params });
  const state = await ctx.saga.execute(staged.actionId);
  return { actionId: staged.actionId, state: state.state };
}

export function searchFlights(
  ctx: TripContext,
  params: { from: string; to: string; date: string },
): Promise<Flight[]> {
  return search<Flight>(ctx, "flights", params);
}

export function searchHotels(
  ctx: TripContext,
  params: { city: string; checkin: string; checkout: string },
): Promise<Hotel[]> {
  return search<Hotel>(ctx, "hotels", params);
}

export function bookFlight(
  ctx: TripContext,
  params: { flightId: string },
): Promise<ActionResult> {
  return transact(ctx, "flight.book", "flights", params);
}

export function bookHotel(
  ctx: TripContext,
  params: { hotelId: string; checkin: string; checkout: string },
): Promise<ActionResult> {
  return transact(ctx, "hotel.book", "hotels", params);
}

export function addCalendarEvent(
  ctx: TripContext,
  params: { title: string; startIso: string; endIso: string },
): Promise<ActionResult> {
  return transact(ctx, "calendar.add", "calendar", params);
}

export async function cancelTrip(ctx: TripContext): Promise<Receipt> {
  await ctx.saga.cancel(ctx.sagaId);
  return ctx.saga.receipt(ctx.sagaId);
}

export function tripStatus(ctx: TripContext): Receipt {
  return ctx.saga.receipt(ctx.sagaId);
}
