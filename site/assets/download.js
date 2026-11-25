// demios.io download page: suggests the installer for the visitor's computer.
// Progressive enhancement only: every installer is listed in the page without this script.
// It runs in the browser, reads only navigator, and sends nothing anywhere.
(function () {
  "use strict";
  var nav = window.navigator;
  var ua = nav.userAgent || "";
  var platform = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || "";

  // Phones and tablets get no suggestion (iPadOS reports itself as a Mac).
  if (/iPhone|iPad|iPod|Android/i.test(ua) || (/Mac/i.test(platform) && nav.maxTouchPoints > 1)) return;

  var os = /Mac/i.test(platform) ? "macos"
    : /Win/i.test(platform) ? "windows"
    : /Linux|X11/i.test(platform) ? "linux"
    : null;
  if (!os) return;

  var names = { macos: "macOS", windows: "Windows", linux: "Linux" };

  function show(arch) {
    var files = Array.prototype.slice.call(document.querySelectorAll('.file[data-os="' + os + '"]'));
    if (os === "macos" && arch) {
      var match = files.filter(function (f) { return f.getAttribute("data-arch") === arch; });
      if (match.length) files = match;
    } else if (os !== "macos") {
      var primary = files.filter(function (f) { return f.hasAttribute("data-primary"); });
      if (primary.length) files = primary;
    }
    if (!files.length) return;

    var list = document.getElementById("for-you-files");
    files.forEach(function (f) {
      var link = f.querySelector(".file-name");
      var a = document.createElement("a");
      a.className = "button button-primary";
      a.href = link.href;
      a.textContent = "Download for " + f.querySelector(".file-for").textContent.split(":")[0] +
        " (" + f.querySelector(".file-size").textContent + ")";
      var li = document.createElement("li");
      li.appendChild(a);
      list.appendChild(li);
      f.classList.add("file-suggested");
    });

    var text = "This looks like a " + names[os] + " computer. ";
    text += os === "macos" && !arch
      ? "Pick the file for your Mac's chip. "
      : "";
    text += "Other systems and the SHA-256 of each file are below.";
    document.getElementById("for-you-text").textContent = text;

    var more = document.createElement("a");
    more.href = "#" + os + "-open";
    more.textContent = "How to open it on " + names[os];
    document.getElementById("for-you-text").appendChild(document.createTextNode(" "));
    document.getElementById("for-you-text").appendChild(more);

    document.getElementById("for-you").hidden = false;
  }

  // Chromium browsers can tell Apple silicon from Intel; Safari and Firefox can't, so both Mac files show.
  if (os === "macos" && nav.userAgentData && nav.userAgentData.getHighEntropyValues) {
    nav.userAgentData.getHighEntropyValues(["architecture"]).then(function (v) {
      show(v.architecture === "arm" ? "arm" : v.architecture === "x86" ? "x86" : null);
    }, function () { show(null); });
  } else {
    show(null);
  }
})();
