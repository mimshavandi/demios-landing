// almend.ai download page: points the visitor to the installer for their computer.
// Progressive enhancement only: every installer is listed in the page without this script.
// It runs in the browser, reads only navigator, and sends nothing anywhere.
// While the preview isn't out, files have no link yet; the box then says so instead of
// offering a download.
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
    var pick = files.filter(function (f) {
      return os === "macos" ? (!arch || f.getAttribute("data-arch") === arch) : f.hasAttribute("data-primary");
    });
    if (pick.length) files = pick;
    if (!files.length) return;

    var list = document.getElementById("for-you-files");
    var linked = 0;
    files.forEach(function (f) {
      f.classList.add("file-suggested");
      var link = f.querySelector("a.file-name");
      if (!link) return;
      linked++;
      var a = document.createElement("a");
      a.className = "button button-primary";
      a.href = link.href;
      var size = f.querySelector(".file-size");
      a.textContent = "Download for " + f.querySelector(".file-title").firstChild.textContent.split(":")[0].trim() +
        (size ? " (" + size.textContent + ")" : "");
      var li = document.createElement("li");
      li.appendChild(a);
      list.appendChild(li);
    });
    if (!linked) list.hidden = true;

    var p = document.getElementById("for-you-text");
    var text = "This looks like a " + names[os] + " computer. ";
    if (!linked) text += "The " + names[os] + " installers are coming shortly. ";
    else if (os === "macos" && !arch) text += "Pick the file for your Mac's chip. ";
    p.textContent = text;
    var more = document.createElement("a");
    more.href = "#" + os + "-open";
    more.textContent = "How to open it on " + names[os];
    p.appendChild(more);

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
