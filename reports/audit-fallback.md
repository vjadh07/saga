# Saga Audit Report - Hotels Vendor Reconciliation

**Date:** 2026-07-12
**Scope:** Vendor `hotels` (39 vendor rows, 41 ledger actions)
**Method:** Full diff of the append-only ledger against vendor ground truth (432 ledger events, 92 vendor rows checked across all vendors), followed by per-action timeline pulls for every finding with ledger evidence.

**Result: 5 reconciliation breaks.** Ordered by severity: 2 unauthorized effects, 1 duplicate charge, 1 phantom compensation, 1 wedged action.

---

## Finding 1 - Unauthorized effect (SHADOW_EFFECT): booking `a7i1jl89g101cbtfbq4n9clp85`

**What the ledger says:** Nothing. `action_timeline(a7i1jl89g101cbtfbq4n9clp85)` returned zero events. No intent was ever staged, called, or committed for this booking.

**What the vendor says:** Hotels holds a live booking:

| Key | Created | Hotel | Check-in | Check-out |
|---|---|---|---|---|
| `a7i1jl89g101cbtfbq4n9clp85` | 2026-07-08T20:09:36Z | H200 | 2026-06-03 | 2026-06-06 |

**Which one cannot be right:** The vendor record cannot be right as an authorized effect. The ledger is append-only; if any agent had authorized this booking, an intent would exist. The vendor holds a booking with no authorization trail. Note also the booking was created (2026-07-08) a month *after* the stay dates (2026-06-03 to 2026-06-06).

---

## Finding 2 - Unauthorized effect (SHADOW_EFFECT): booking `nikqpt48qq9dvmvj665fu9eq2u`

**What the ledger says:** Nothing. `action_timeline(nikqpt48qq9dvmvj665fu9eq2u)` returned zero events.

**What the vendor says:** Hotels holds a live booking:

| Key | Created | Hotel | Check-in | Check-out |
|---|---|---|---|---|
| `nikqpt48qq9dvmvj665fu9eq2u` | 2026-06-11T13:55:12Z | H300 | 2026-06-15 | 2026-06-16 |

**Which one cannot be right:** The vendor record cannot be right as an authorized effect. No ledger intent ever authorized it. The booking exists at the vendor with no corresponding action anywhere in the ledger.

---

## Finding 3 - Duplicate charge (DUPLICATE_CHARGE): `q2nnvpo3g6isruo4rdl7789epc` duplicates authorized booking `8delfe9i7n6732p6bsrc604q4r`

**What the ledger says:** Exactly one authorized booking of H300, 2026-06-12 → 2026-06-14. Timeline for action `8delfe9i7n6732p6bsrc604q4r`:

| Event | At | Payload |
|---|---|---|
| STAGED | 2026-07-07T23:40:00Z | `hotel.book`, vendor `hotels`, H300, 2026-06-12 → 2026-06-14 |
| CALLED | 2026-07-08T07:43:20Z | attempt 1 |
| RECONCILED | 2026-07-08T09:20:00Z | landed: true |
| COMMITTED | 2026-07-08T10:56:40Z | - |

The ledger shows a single call attempt (attempt 1) that landed and committed cleanly. `action_timeline(q2nnvpo3g6isruo4rdl7789epc)` returned zero events - the second booking has no ledger authorization of its own.

**What the vendor says:** Two identical bookings exist:

| Key | Created | Hotel | Check-in | Check-out |
|---|---|---|---|---|
| `8delfe9i7n6732p6bsrc604q4r` | 2026-07-08T06:14:24Z | H300 | 2026-06-12 | 2026-06-14 |
| `q2nnvpo3g6isruo4rdl7789epc` | 2026-06-27T05:45:36Z | H300 | 2026-06-12 | 2026-06-14 |

**Which one cannot be right:** The vendor cannot rightly hold two bookings when the ledger authorized one. One intent, one call attempt, one commit - yet two vendor rows. The duplicate row `q2nnvpo3g6isruo4rdl7789epc` was created 2026-06-27, roughly 11 days *before* the authorizing intent was even staged (2026-07-07), so it cannot be a retry artifact of this action; it is an unauthorized second charge for the same stay.

---

## Finding 4 - Phantom compensation (PHANTOM_COMPENSATION): booking `lj3s76f05tm2moui549i86dnp3`

**What the ledger says:** The booking was made and then fully compensated (undone). Timeline:

| Event | At | Payload |
|---|---|---|
| STAGED | 2026-06-15T16:46:40Z | `hotel.book`, vendor `hotels`, H100, 2026-06-08 → 2026-06-10 |
| CALLED | 2026-06-16T00:50:00Z | attempt 1 |
| RECONCILED | 2026-06-16T02:26:40Z | landed: true |
| COMMITTED | 2026-06-16T04:03:20Z | - |
| COMPENSATION_CALLED | 2026-06-16T13:43:20Z | - |
| COMPENSATED | 2026-06-16T15:20:00Z | - |

**What the vendor says:** The booking is still live:

| Key | Created | Hotel | Check-in | Check-out |
|---|---|---|---|---|
| `lj3s76f05tm2moui549i86dnp3` | 2026-06-22T00:28:48Z | H100 | 2026-06-08 | 2026-06-10 |

**Which one cannot be right:** They cannot both be right. The ledger recorded COMPENSATED at 2026-06-16T15:20Z, meaning the undo was confirmed - yet the vendor still holds the booking. Either the compensation never actually took effect at the vendor, or the vendor re-created the row afterwards: the vendor row's `createdAt` (2026-06-22) is nearly six days *after* the ledger recorded the compensation as complete. The customer is still booked for a stay the system believes was cancelled.

---

## Finding 5 - Wedged action (WEDGED_SAGA): `jn2umj4ik5lbnvtcihnpe84pei` stuck at CALLED

**What the ledger says:** The action was staged and called, then the trail stops:

| Event | At | Payload |
|---|---|---|
| STAGED | 2026-07-09T22:23:20Z | `hotel.book`, vendor `hotels`, H200, 2026-06-20 → 2026-06-21 |
| CALLED | 2026-07-10T00:00:00Z | attempt 1 |

No RECONCILED, COMMITTED, FAILED, or COMPENSATED event has been appended in the ~2 days since.

**What the vendor says:** No matching booking row exists.

**Which one cannot be right:** This is not a contradiction but an unresolved in-flight state: the ledger fired a call to the vendor and never learned the outcome. The vendor holds nothing, which suggests the call likely did not land - but the saga cannot be closed without a reconciliation step. The action needs to be either reconciled-and-committed or failed-and-released.

---

## Summary table

| # | Kind | Subject | Ledger state | Vendor state |
|---|---|---|---|---|
| 1 | SHADOW_EFFECT | `a7i1jl89g101cbtfbq4n9clp85` | No events | Live booking H200 |
| 2 | SHADOW_EFFECT | `nikqpt48qq9dvmvj665fu9eq2u` | No events | Live booking H300 |
| 3 | DUPLICATE_CHARGE | `q2nnvpo3g6isruo4rdl7789epc` | One authorized commit (`8delfe9i7n6732p6bsrc604q4r`) | Two identical bookings |
| 4 | PHANTOM_COMPENSATION | `lj3s76f05tm2moui549i86dnp3` | COMPENSATED 2026-06-16 | Booking still live |
| 5 | WEDGED_SAGA | `jn2umj4ik5lbnvtcihnpe84pei` | Stuck at CALLED since 2026-07-10 | No row |

All statements above are drawn directly from `run_reconciliation` output and `action_timeline` pulls; no inference beyond the tool evidence.
