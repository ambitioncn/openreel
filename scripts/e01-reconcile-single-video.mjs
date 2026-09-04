#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPlatform } from "../src/platform.js";

const file = process.env.OPENREEL_PLATFORM_FILE;
assert.ok(file && file.startsWith("/var/lib/openreel-staging/"), "reconciliation is restricted to isolated staging state");
assert.equal(process.env.OPENREEL_E01_RECONCILE_AUTHORIZATION_ID, "openreel-e01-single-video-cp64");
const before = JSON.parse(readFileSync(file, "utf8"));
const open = before.usageReservations.filter(item => item.status === "reserved" && item.model === "seedance-2-fast" && item.maxCostMicros === 6_945);
assert.equal(open.length, 1, "exactly one cp64-shaped open reservation is required");
const reservation = open[0];
const subscription = before.subscriptions.find(item => item.id === reservation.subscriptionId);
assert.equal(subscription?.status, "stopped", "temporary subscription must already be stopped");
assert.equal(subscription?.reservedMicros, 6_945, "only the cp64 ceiling may remain reserved");
const applications = before.keyApplications.filter(item => item.subscriptionId === reservation.subscriptionId && item.status === "stopped");
assert.equal(applications.length, 1, "exactly one stopped application must own the reservation");
const platform = createPlatform({ file });
const entries = platform.failStoppedAccessReservations(applications[0].id);
assert.equal(entries.length, 1);
const after = JSON.parse(readFileSync(file, "utf8")), updated = after.usageReservations.find(item => item.id === reservation.id), updatedSubscription = after.subscriptions.find(item => item.id === reservation.subscriptionId);
assert.equal(updated?.status, "failed");
assert.equal(updatedSubscription?.reservedMicros, 0);
process.stdout.write(`${JSON.stringify({ status: "reconciled", matchedReservations: 1, reservationStatus: "failed", reservedUnits: 0, spentUnits: updatedSubscription.spentMicros })}\n`);
