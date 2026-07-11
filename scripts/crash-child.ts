// Books a fixed two-leg trip through the saga engine. Run once with
// CRASH_AFTER set to die mid-transaction, then run again without it to
// watch recovery converge. Used by test/kill9.test.ts and demo rehearsal.
import { Ledger } from "../src/ledger/ledger.js";
import { Saga } from "../src/core/saga.js";
import { crashAfter } from "../src/core/crash.js";
import { httpVendor } from "../src/vendors/http-adapter.js";

const ledgerPath = process.env.LEDGER_PATH;
const vendorUrl = process.env.VENDOR_URL;
if (!ledgerPath || !vendorUrl) {
  console.error("LEDGER_PATH and VENDOR_URL are required");
  process.exit(2);
}
const sagaId = process.env.SAGA_ID ?? "crash-trip";

const ledger = new Ledger(ledgerPath);
const saga = new Saga({
  ledger,
  vendors: {
    flights: httpVendor(vendorUrl, "flights"),
    hotels: httpVendor(vendorUrl, "hotels"),
  },
  onEvent: crashAfter(process.env.CRASH_AFTER),
});

// second life: finish whatever an earlier life left in flight
await saga.recover(sagaId);

// stage only what no earlier life already put on the ledger
const alreadyStaged = new Set(
  ledger.actions(sagaId).map((a) => String(a.staged.type)),
);

if (!alreadyStaged.has("flight.book")) {
  const flight = saga.stage({
    sagaId,
    type: "flight.book",
    vendor: "flights",
    params: { flightId: "F100" },
  });
  await saga.execute(flight.actionId);
}

if (!alreadyStaged.has("hotel.book")) {
  const hotel = saga.stage({
    sagaId,
    type: "hotel.book",
    vendor: "hotels",
    params: { hotelId: "H100" },
  });
  await saga.execute(hotel.actionId);
}

console.log(JSON.stringify(saga.receipt(sagaId), null, 2));
ledger.close();
