/* "Will it run?" — advisory only. The installer re-checks real memory and disk.
   Nothing here is sent anywhere: no fetch, no beacon, no analytics. */
(function () {
  "use strict";

  var root = document.getElementById("spec-check");
  if (!root) return;

  var TIERS = [
    { key: "core", label: "8B", weights: 5.0, ram: 16, speed: 43, note: "fast and light" },
    { key: "pro", label: "14B", weights: 9.0, ram: 24, speed: 25, note: "noticeably better reasoning" },
    { key: "studio", label: "35B", weights: 22.4, ram: 32, speed: 52, note: "mixture of experts, the full operator" }
  ];

  var osEl = root.querySelector("#sc-os");
  var ramEl = root.querySelector("#sc-ram");
  var diskEl = root.querySelector("#sc-disk");
  var out = root.querySelector("#sc-out");

  function detectOS() {
    var ua = navigator.userAgent || "";
    var plat = navigator.platform || "";
    if (/Mac/i.test(plat) || /Mac OS X/i.test(ua)) {
      return { key: "mac", name: "macOS", arm: /arm64|aarch64/i.test(ua) || plat === "MacIntel" && navigator.maxTouchPoints > 1 };
    }
    if (/Win/i.test(plat) || /Windows/i.test(ua)) return { key: "win", name: "Windows", arm: /ARM64|arm64/i.test(ua) };
    if (/Linux/i.test(plat) || /Linux/i.test(ua)) return { key: "linux", name: "Linux", arm: /aarch64|arm64/i.test(ua) };
    return { key: "unknown", name: "Unknown", arm: false };
  }

  function pick(ram) {
    var chosen = TIERS[0];
    for (var i = 0; i < TIERS.length; i++) if (ram >= TIERS[i].ram) chosen = TIERS[i];
    return chosen;
  }

  function render() {
    var os = detectOS();
    var ram = parseInt(ramEl.value, 10) || 16;
    var diskGB = parseFloat(diskEl.value);
    var tier = pick(ram);
    var warn = [];

    if (osEl) osEl.textContent = os.name + (os.arm ? " · ARM64" : "");

    if (os.key === "mac" && !os.arm) {
      warn.push("Intel Macs aren't supported by the current build — it is Apple Silicon only.");
    }
    if (ram < 16) {
      warn.push("Below 16 GB the assistant runs, but the operating system will fight it for memory.");
    }
    if (!isNaN(diskGB) && diskGB < tier.weights + 10) {
      warn.push("Needs about " + (tier.weights + 10) + " GB free: " + tier.weights +
                " GB for the model plus room for the app and updates.");
    }

    var rows = TIERS.map(function (t) {
      var active = t.key === tier.key;
      return '<tr style="' + (active ? "color:#f5fafc;font-weight:600" : "") + '">' +
        "<td>" + t.label + (active ? " ← your machine" : "") + "</td>" +
        "<td>" + t.weights + " GB</td>" +
        "<td>" + t.ram + " GB+</td>" +
        "<td>~" + t.speed + " tok/s</td></tr>";
    }).join("");

    out.innerHTML =
      '<p class="small" style="margin-bottom:10px">' + os.name +
      (os.arm ? " · ARM64" : "") + " · " + ram + " GB memory</p>" +
      "<p style=\"margin-bottom:14px\">Your machine will run the <b>" + tier.label +
      "</b> model (" + tier.note + "), a " + tier.weights + " GB download.</p>" +
      '<div class="table-wrap"><table><thead><tr><th>Model</th><th>Download</th><th>Memory</th><th>Speed</th></tr></thead>' +
      "<tbody>" + rows + "</tbody></table></div>" +
      (warn.length ? '<div class="note" style="margin-top:14px">' +
        warn.map(function (w) { return "· " + w; }).join("<br>") + "</div>" : "") +
      '<p class="small" style="margin-top:12px">Speeds measured with a 120-token reply at 4K context on an M1 Max. ' +
      "The installer checks your real memory and free disk before it downloads anything.</p>";
  }

  ramEl.addEventListener("change", render);
  diskEl.addEventListener("input", render);
  render();
})();
