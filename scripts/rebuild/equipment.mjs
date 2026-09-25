// Equipment assets and consumable inventory, every one a line on the 2026 rate sheet.
import { push, P, productById, NAME, at } from "./core.mjs";

const asset = (id, tag, slug, category, extra = {}) => {
  const product = productById.get(P(slug));
  return push("equipmentAssets", { id, assetTag: tag, equipment: product.name, category, status: "In service", maintenanceDue: "", lastUsed: "", assignedProjectId: "", productId: product.id, issue: "", specs: {}, ...extra });
};

// Vehicles & response units
asset("asset-truck-101", "TRK-101", "hazmat-recovery-truck", "Vehicle", { maintenanceDue: "2026-10-15", lastUsed: "2026-09-24", specs: { vin: "", licensePlate: "", mileage: "41,200", fuelType: "Diesel", insurancePolicy: "", registrationExpires: "2027-03-31" } });
asset("asset-truck-102", "TRK-102", "3-4-ton-or-1-ton-pick-up-truck", "Vehicle", { maintenanceDue: "2026-11-01", lastUsed: "2026-09-25", specs: { licensePlate: "", mileage: "58,410", fuelType: "Diesel", registrationExpires: "2027-01-31" } });
asset("asset-truck-103", "TRK-103", "3-4-ton-or-1-ton-pick-up-truck", "Vehicle", { equipment: "Tesla Cybertruck (3/4 ton class)", maintenanceDue: "2026-12-01", lastUsed: "2026-09-23", specs: { licensePlate: "", mileage: "22,980", fuelType: "Electric", registrationExpires: "2027-01-31" } });
asset("asset-cru-201", "CRU-201", "environmental-cyberresponse-unit", "General equipment", { maintenanceDue: "2026-10-20", lastUsed: "2026-09-24" });
asset("asset-mst-202", "MST-202", "microbial-spray-trailer", "General equipment", { maintenanceDue: "2026-10-05", lastUsed: "2026-09-20" });
asset("asset-vac-204", "VAC-204", "vactron", "Vacuum / Vactron", { maintenanceDue: "2026-10-01", lastUsed: "2026-09-19", specs: { tankCapacity: "800 gal", pumpPressure: "27 in-Hg", engineHours: "812", deconStatus: "Clean" } });
asset("asset-drone-301", "DRONE-301", "drone-service-includes-operator", "General equipment", { maintenanceDue: "2027-01-15", lastUsed: "2026-09-10" });
// Trailers
asset("asset-trl-210", "TRL-210", "oil-spill-trailer", "General equipment", { maintenanceDue: "2026-11-15", lastUsed: "2026-09-24" });
asset("asset-trl-211", "TRL-211", "hazmat-response-trailer-tools-package", "General equipment", { maintenanceDue: "2026-11-15", lastUsed: "2026-09-19" });
asset("asset-trl-212", "TRL-212", "dump-trailer", "General equipment", { maintenanceDue: "2026-10-30", lastUsed: "2026-08-06" });
asset("asset-trl-213", "TRL-213", "gooseneck-equipment-tailer", "General equipment", { maintenanceDue: "2026-10-30", lastUsed: "2026-09-19" });
// Heavy equipment
asset("asset-skid-401", "SKID-401", "skid-steer-front-loader-does-not-include-operator-or-trailer", "Heavy Equipment", { maintenanceDue: "2026-10-10", lastUsed: "2026-09-19", specs: { hours: "1,140" } });
asset("asset-exc-402", "EXC-402", "mini-excavator-does-not-include-operator-or-trailer", "Heavy Equipment", { status: "Maintenance hold", issue: "Hydraulic line weeping at the boom cylinder; parts ordered.", maintenanceDue: "2026-09-22", lastUsed: "2026-09-19", specs: { hours: "890" } });
// Pumps, generators, washers, monitoring
asset("asset-pmp-501", "PMP-501", "2-poly-air-operated-diaphragm-pump", "Pump", { maintenanceDue: "2026-12-01", lastUsed: "2026-09-20" });
asset("asset-pmp-502", "PMP-502", "1-engine-driven-medium-pressure-diaphragm-pump", "Pump", { maintenanceDue: "2026-12-01", lastUsed: "2026-07-03" });
asset("asset-gen-601", "GEN-601", "generator-5-1kw-to-8kw", "General equipment", { maintenanceDue: "2026-11-20", lastUsed: "2026-09-20" });
asset("asset-cmp-602", "CMP-602", "185-cfm-air-compressor", "General equipment", { maintenanceDue: "2026-11-20", lastUsed: "2026-09-19" });
asset("asset-pw-701", "PW-701", "3500-psi-trailer-mounted-hot-water-pressure-washer-includes-", "General equipment", { maintenanceDue: "2026-10-12", lastUsed: "2026-09-24" });
asset("asset-gas-801", "GAS-801", "4-gas-air-monitoring-instrument", "General equipment", { maintenanceDue: "2026-10-01", lastUsed: "2026-09-24", issue: "Bump test due", specs: { calibrationDue: "2026-10-01" } });
asset("asset-pid-802", "PID-802", "pid", "General equipment", { maintenanceDue: "2026-12-15", lastUsed: "2026-09-11" });
asset("asset-scba-803", "SCBA-803", "60-minute-scba", "Air Filtration", { maintenanceDue: "2026-10-31", lastUsed: "2026-07-03", specs: { hydroTestDue: "2027-06-30" } });

push("equipmentMaintenanceRecords", { id: "maint-vac-204-service", assetTag: "VAC-204", type: "Scheduled service", date: "2026-09-01", description: "Vacuum pump oil change, hose inspection, decon verified.", performedBy: NAME.logan, cost: 0, nextDueDate: "2026-10-01" });
push("equipmentMaintenanceRecords", { id: "maint-exc-402-hydraulic", assetTag: "EXC-402", type: "Repair", date: "2026-09-22", description: "Boom cylinder hydraulic line found weeping after the pipeline site. Replacement line ordered; unit on hold.", performedBy: NAME.logan, cost: 0, nextDueDate: "" });
push("equipmentMaintenanceRecords", { id: "maint-truck-101-service", assetTag: "TRK-101", type: "Scheduled service", date: "2026-08-15", description: "Oil and filters, brake inspection, DOT annual.", performedBy: "Georgetown Truck Center", cost: 640, nextDueDate: "2026-10-15" });
push("equipmentMaintenanceRecords", { id: "maint-gas-801-cal", assetTag: "GAS-801", type: "Calibration", date: "2026-09-01", description: "Full calibration against certified gas; sensors within spec.", performedBy: NAME.tristan, cost: 0, nextDueDate: "2026-10-01" });
push("equipmentRestockItems", { id: "restock-trl-210-pads", assetTag: "TRL-210", itemName: "White oil absorbent pads", quantityNeeded: 2, unit: "bales", status: "Needed", notes: "Used two bales on the Georgetown storm drain job." });
push("equipmentRestockItems", { id: "restock-trl-211-gloves", assetTag: "TRL-211", itemName: "Nitrile gloves (chemical)", quantityNeeded: 12, unit: "pairs", status: "Needed", notes: "" });
push("equipmentRestockItems", { id: "restock-cru-201-boom", assetTag: "CRU-201", itemName: '5" oil absorbent boom', quantityNeeded: 1, unit: "bale", status: "Ordered", notes: "" });

// Consumables. `materialType` is the display name Front Line shows; `productId` links the rate line.
const item = (id, slug, unit, onHand, reorderAt, targetStock, extra = {}) => {
  const product = productById.get(P(slug));
  return push("inventoryItems", { id, materialType: product.name, unit, onHand, reorderAt, targetStock, buyer: NAME.tristan, barcode: "", productId: product.id, ...extra });
};
item("inv-pads-white", "white-oil-absorbent-pads-100-bale", "bales", 14, 6, 24);
item("inv-pads-grey", "grey-universal-absorbent-pads-100-bale", "bales", 5, 4, 12);
item("inv-pads-green", "green-chemical-absorbent-pads-100-bale", "bales", 3, 2, 6);
item("inv-floor-dry", "floor-dry-stay-dry-clay-absorbent-40-lb-bag", "bags", 42, 20, 80);
item("inv-sock-10ft", "10-ft-absorbent-sock", "sections", 18, 10, 40);
item("inv-sock-3ft", "3-ft-absorbent-sock", "sections", 26, 12, 48);
item("inv-boom-5in", "5-oil-absorbent-boom-40-bale", "bales", 3, 3, 8);
item("inv-sweep", "oil-absorbent-sweep-100-x19", "bales", 2, 1, 4);
item("inv-micro-bac-s", "micro-bac-s", "gallons", 60, 30, 120);
item("inv-mega-bac-x", "mega-bac-x", "gallons", 35, 20, 80);
item("inv-agri-bac", "agri-bac", "gallons", 12, 10, 30);
item("inv-tri-phasic", "tri-phasic-12", "gallons", 8, 5, 20);
item("inv-degreaser", "cleaner-degreaser", "gallons", 15, 10, 30);
item("inv-barrier-tape", "barrier-tape", "rolls", 9, 6, 20);
item("inv-duct-tape", "duct-tape", "rolls", 11, 6, 24);
item("inv-drum-55-poly-open", "55-gal-poly-open-top", "each", 9, 6, 16);
item("inv-drum-55-steel-open", "55-gal-open-top-steel-drum", "each", 6, 4, 12);
item("inv-overpack-95", "95-gal-poly-overpack", "each", 2, 2, 4);
item("inv-bucket-5-dot", "5-gal-bucket-dot-rated", "each", 20, 12, 40);
item("inv-trash-bags-case", "trash-bags-case", "cases", 4, 2, 8);
item("inv-ppe-level-d", "level-d-ppe-package-hard-hat-safety-glasses-and-safety-vest", "packages", 18, 10, 30);
item("inv-ppe-mod-level-d", "modified-level-d-ppe-package-hard-hat-safety-glasses-tyvek-s", "packages", 12, 8, 24);
item("inv-tychem-2000", "tychem-2000-protective-coveralls-polycoated-tyvek-coveralls", "suits", 22, 12, 40);
item("inv-nitrile-gloves", "nitrile-gloves-chemical", "pairs", 48, 40, 120);
item("inv-boot-covers", "latex-boot-covers", "pairs", 30, 20, 60);
item("inv-ov-cartridges", "organic-vapor-cartridges", "pairs", 7, 6, 16);
item("inv-ph-strips", "ph-test-strips", "each", 90, 50, 200);
item("inv-wooden-stakes", "wooden-stakes", "each", 40, 20, 80);
item("inv-sampling-supplies", "sampling-supplies", "sample kits", 24, 12, 48);

push("purchaseOrders", { id: "po-20260918-pads", itemId: "inv-pads-white", materialType: "White, Oil Absorbent Pads (100/bale)", quantity: 10, vendor: "New Pig", status: "Received", requestedBy: NAME.tristan, receivedAt: at("2026-09-22", "10:15"), receivedBy: NAME.tristan, receivedQuantity: 10 }, at("2026-09-18", "09:00"));
push("purchaseOrders", { id: "po-20260923-boom", itemId: "inv-boom-5in", materialType: '5" Oil Absorbent Boom (40\' bale)', quantity: 6, vendor: "New Pig", status: "Ordered", requestedBy: NAME.tristan, receivedAt: "", receivedBy: "", receivedQuantity: 0 }, at("2026-09-23", "14:30"));
push("purchaseOrders", { id: "po-20260924-microbac", itemId: "inv-micro-bac-s", materialType: "Micro-Bac-S", quantity: 55, vendor: "Micro-Bac International", status: "Ordered", requestedBy: NAME.logan, receivedAt: "", receivedBy: "", receivedQuantity: 0 }, at("2026-09-24", "16:05"));
push("inventoryAlerts", { id: "inventory-alert-boom-low", inventoryItemId: "inv-boom-5in", materialType: '5" Oil Absorbent Boom (40\' bale)', jobId: "", actionId: "", requestedQuantity: 0, onHandAtRequest: 3, resultingBalance: 3, requestedBy: "Stock check", status: "Open" }, at("2026-09-23", "14:20"));
