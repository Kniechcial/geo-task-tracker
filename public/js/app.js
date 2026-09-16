/* GeoTasker — logika aplikacji.
   Mapa + geolokalizacja, CRUD zadań, dwukierunkowe bindowanie lista <-> mapa,
   tryby: trasa / strefa / pomiar (Turf.js), filtry i sortowanie. */

(function () {
  "use strict";

  var DEFAULT_CENTER = [50.0647, 19.945]; // Kraków
  var DEFAULT_ZOOM = 13;

  var CATEGORY_DEFAULT = "Inne";
  var PRIORITY_LABEL = { wysoki: "Wysoki", sredni: "Średni", niski: "Niski" };
  var PRIORITY_RANK = { wysoki: 0, sredni: 1, niski: 2 };

  var map;
  var userMarker;
  var userPos = null; // [lat, lng] gdy znana pozycja użytkownika
  var hasInteracted = false; // czy użytkownik już wchodził w interakcję z mapą
  var markers = {}; // id zadania -> Leaflet marker
  var activeId = null; // aktualnie podświetlone zadanie

  // Widok listy
  var filterState = "all"; // all | active | done
  var searchQuery = "";
  var sortBy = "created"; // created | priority | distance

  // Tryb trasy
  var routeMode = false;
  var routeOrder = [];
  var routeLayer = null;

  // Tryb strefy
  var zoneMode = false;
  var zoneVertices = []; // [[lat,lng], ...]
  var zoneMarkers = []; // markery wierzchołków
  var zoneLayer = null; // L.polygon / L.polyline
  var zoneInsideIds = []; // id zadań wewnątrz strefy

  // Tryb pomiaru (odległość między dowolnymi punktami na mapie)
  var measureMode = false;
  var measurePoints = []; // [[lat,lng], ...]
  var measureMarkers = []; // markery klikniętych punktów
  var measureLayer = null; // polilinia pomiaru

  /* ---------------- Mapa ---------------- */

  function initMap() {
    map = L.map("map", { zoomControl: true }).setView(
      DEFAULT_CENTER,
      DEFAULT_ZOOM
    );

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    map.on("click", function (e) {
      if (zoneMode) {
        addZoneVertex(e.latlng);
        return;
      }
      if (measureMode) {
        addMeasurePoint(e.latlng);
        return;
      }
      if (routeMode) return;
      hasInteracted = true;
      openModalForNew(e.latlng.lat, e.latlng.lng);
    });
  }

  // Widok startowy: dopasuj do zapisanych zadań, a przy ich braku spróbuj geolokalizacji.
  function initialView() {
    var ids = Object.keys(markers);
    if (ids.length === 0) {
      locateUser({ auto: true });
    } else if (ids.length === 1) {
      map.setView(markers[ids[0]].getLatLng(), 15);
    } else {
      fitAllTasks();
    }
  }

  function fitAllTasks() {
    var ids = Object.keys(markers);
    if (!ids.length) return;
    if (ids.length === 1) {
      map.setView(markers[ids[0]].getLatLng(), 15);
      return;
    }
    var group = L.featureGroup(
      ids.map(function (id) {
        return markers[id];
      })
    );
    map.fitBounds(group.getBounds().pad(0.2));
  }

  function showUserLocation(lat, lng, options) {
    options = options || {};
    userPos = [lat, lng];
    var latlng = [lat, lng];

    if (userMarker) {
      userMarker.setLatLng(latlng);
    } else {
      userMarker = L.circleMarker(latlng, {
        radius: 7,
        color: "#2f6fed",
        fillColor: "#2f6fed",
        fillOpacity: 0.9,
        weight: 3,
      })
        .addTo(map)
        .bindPopup("Tu jesteś");
    }

    var wantCenter = options.center !== false;
    // Startowe (automatyczne) wyśrodkowanie nie może wyrwać widoku po interakcji.
    if (options.auto && hasInteracted) wantCenter = false;
    if (wantCenter) map.setView(latlng, Math.max(map.getZoom(), 14));

    if (sortBy === "distance") renderList();
  }

  function locateUser(options) {
    options = options || {};
    if (!("geolocation" in navigator)) {
      if (!options.auto) toast("Geolokalizacja niedostępna");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        showUserLocation(pos.coords.latitude, pos.coords.longitude, options);
      },
      function () {
        if (!options.auto) toast("Nie udało się ustalić lokalizacji");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  /* ---------------- Markery ---------------- */

  function makeIcon(task, orderNum) {
    var priorityClass = task.done ? "done" : task.priority;
    var routeClass = orderNum ? " task-pin--route" : "";
    var inner = orderNum ? orderNum : task.done ? "✓" : "";
    return L.divIcon({
      className: "task-pin-wrap",
      html:
        '<span class="task-pin task-pin--' +
        priorityClass +
        routeClass +
        '"><span>' +
        inner +
        "</span></span>",
      iconSize: [24, 24],
      iconAnchor: [12, 22],
      popupAnchor: [0, -20],
    });
  }

  function popupHtml(task) {
    var html = "<strong>" + escapeHtml(task.title) + "</strong>";
    if (task.description) {
      html +=
        '<br><span style="color:#6b7684">' +
        escapeHtml(task.description) +
        "</span>";
    }
    html +=
      "<br><small>" +
      escapeHtml(task.category) +
      " · " +
      (PRIORITY_LABEL[task.priority] || task.priority) +
      (task.done ? " · ukończone" : "") +
      "</small>";
    return html;
  }

  function addMarker(task) {
    var marker = L.marker([task.lat, task.lng], { icon: makeIcon(task) })
      .addTo(map)
      .bindPopup(popupHtml(task), { autoPan: false });

    marker.on("click", function () {
      if (routeMode) toggleRouteStop(task.id);
      else setActive(task.id);
    });

    markers[task.id] = marker;
  }

  function refreshMarkerIcons() {
    TaskStore.all().forEach(function (task) {
      var marker = markers[task.id];
      if (!marker) return;
      var idx = routeOrder.indexOf(task.id);
      marker.setIcon(makeIcon(task, idx === -1 ? null : idx + 1));
    });
  }

  function updateMarker(task) {
    var marker = markers[task.id];
    if (!marker) return;
    marker.setLatLng([task.lat, task.lng]);
    marker.setIcon(makeIcon(task));
    marker.setPopupContent(popupHtml(task));
  }

  function removeMarker(id) {
    if (markers[id]) {
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  }

  /* ---------------- Lista (panel boczny) ---------------- */

  // Zadania po zastosowaniu filtra, wyszukiwarki i sortowania.
  function visibleTasks() {
    var q = searchQuery.trim().toLowerCase();
    var list = TaskStore.all().filter(function (t) {
      if (filterState === "active" && t.done) return false;
      if (filterState === "done" && !t.done) return false;
      if (q) {
        var hay = (t.title + " " + (t.description || "") + " " + t.category)
          .toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    if (sortBy === "priority") {
      list.sort(function (a, b) {
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      });
    } else if (sortBy === "distance" && userPos) {
      list.sort(function (a, b) {
        return distanceFromUser(a) - distanceFromUser(b);
      });
    } else {
      list.sort(function (a, b) {
        return a.createdAt - b.createdAt;
      });
    }
    return list;
  }

  function distanceFromUser(task) {
    return turf.distance(
      turf.point([userPos[1], userPos[0]]),
      turf.point([task.lng, task.lat])
    );
  }

  function renderList() {
    var $list = $("#task-list").empty();
    var total = TaskStore.all().length;
    var tasks = visibleTasks();

    if (total === 0) {
      $list.html(
        '<p class="empty-state">Kliknij na mapie, aby dodać pierwsze zadanie.</p>'
      );
    } else if (tasks.length === 0) {
      $list.html(
        '<p class="empty-state">Brak zadań pasujących do filtrów.</p>'
      );
    } else {
      tasks.forEach(function (task) {
        $list.append(buildTaskItem(task));
      });
    }
    updateStats();
  }

  function buildTaskItem(task) {
    var routeIdx = routeOrder.indexOf(task.id);
    var inZone = zoneInsideIds.indexOf(task.id) !== -1;

    var $item = $('<div class="task-item"></div>')
      .attr("data-id", task.id)
      .toggleClass("is-done", !!task.done)
      .toggleClass("is-active", task.id === activeId)
      .toggleClass("in-route", routeIdx !== -1)
      .toggleClass("in-zone", inZone);

    var $check = $('<input type="checkbox" class="task-item__check">')
      .prop("checked", !!task.done)
      .attr("title", "Oznacz jako wykonane");

    var $main = $('<div class="task-item__main"></div>');
    $('<div class="task-item__title"></div>').text(task.title).appendTo($main);
    if (task.description) {
      $('<div class="task-item__desc"></div>')
        .text(task.description)
        .appendTo($main);
    }

    var $meta = $('<div class="task-item__meta"></div>');
    if (routeIdx !== -1) {
      $('<span class="order-badge"></span>').text(routeIdx + 1).appendTo($meta);
    }
    if (inZone) {
      $('<span class="badge badge--zone"></span>')
        .text("w strefie")
        .appendTo($meta);
    }
    $('<span class="badge badge--category"></span>')
      .text(task.category)
      .appendTo($meta);
    $('<span class="badge"></span>')
      .addClass("badge--" + task.priority)
      .text(PRIORITY_LABEL[task.priority] || task.priority)
      .appendTo($meta);
    $meta.appendTo($main);

    var $actions = $('<div class="task-item__actions"></div>');
    $('<button class="icon-btn" title="Edytuj">✏️</button>')
      .attr("data-action", "edit")
      .appendTo($actions);
    $('<button class="icon-btn icon-btn--danger" title="Usuń">🗑️</button>')
      .attr("data-action", "delete")
      .appendTo($actions);

    return $item.append($check, $main, $actions);
  }

  function updateStats() {
    var all = TaskStore.all();
    var done = all.filter(function (t) {
      return t.done;
    }).length;
    $("#stats").text("Zadania: " + all.length + " · Ukończone: " + done);
  }

  /* ---------------- Dwukierunkowe bindowanie / fokus ---------------- */

  function highlightActive(id) {
    activeId = id;
    $(".task-item").removeClass("is-active");
    var $item = $('.task-item[data-id="' + id + '"]').addClass("is-active");
    if ($item.length) {
      $item[0].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // gentle: dosuń zadanie do widoku bez przeskoku zoomu (po dodaniu).
  // locate: wyśrodkuj i przybliż (po kliknięciu na liście / markerze).
  function focusTask(id, opts) {
    opts = opts || {};
    highlightActive(id);
    var task = TaskStore.get(id);
    if (!task || !markers[id]) return;

    if (opts.gentle) {
      map.panInside([task.lat, task.lng], { padding: [40, 110] });
    } else {
      map.setView([task.lat, task.lng], Math.max(map.getZoom(), 15), {
        animate: true,
      });
    }
    markers[id].openPopup();
  }

  function setActive(id) {
    focusTask(id, { gentle: false });
  }

  /* ---------------- Tryb trasy (Turf.js) ---------------- */

  function exitRouteMode() {
    routeMode = false;
    $("#route-toggle").removeClass("btn--active");
    $("#route-bar").prop("hidden", true);
    $("#route-hint").prop("hidden", true);
    clearRoute();
  }

  function toggleRouteMode() {
    if (routeMode) {
      exitRouteMode();
      renderList();
      return;
    }
    exitOtherModes("route");
    routeMode = true;
    activeId = null;
    $("#route-toggle").addClass("btn--active");
    $("#route-bar").prop("hidden", false);
    $("#route-hint").prop("hidden", false);
    updateRouteInfo();
    renderList();
  }

  function toggleRouteStop(id) {
    var i = routeOrder.indexOf(id);
    if (i === -1) routeOrder.push(id);
    else routeOrder.splice(i, 1);
    drawRoute();
    refreshMarkerIcons();
    updateRouteInfo();
    renderList();
  }

  function clearRoute() {
    routeOrder = [];
    drawRoute();
    refreshMarkerIcons();
    updateRouteInfo();
    renderList();
  }

  function removeFromRoute(id) {
    var ri = routeOrder.indexOf(id);
    if (ri === -1) return;
    routeOrder.splice(ri, 1);
    drawRoute();
    refreshMarkerIcons();
    updateRouteInfo();
  }

  function routeLatLngs() {
    return routeOrder
      .map(function (id) {
        var t = TaskStore.get(id);
        return t ? [t.lat, t.lng] : null;
      })
      .filter(Boolean);
  }

  function drawRoute() {
    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }
    var pts = routeLatLngs();
    if (pts.length >= 2) {
      routeLayer = L.polyline(pts, {
        color: "#2f6fed",
        weight: 4,
        opacity: 0.85,
        dashArray: "6,8",
      }).addTo(map);
    }
  }

  function computeRouteKm() {
    var lngLat = routeOrder
      .map(function (id) {
        var t = TaskStore.get(id);
        return t ? [t.lng, t.lat] : null;
      })
      .filter(Boolean);
    if (lngLat.length < 2) return 0;
    return turf.length(turf.lineString(lngLat), { units: "kilometers" });
  }

  function updateRouteInfo() {
    var n = routeOrder.length;
    $("#route-distance").text(formatDistance(computeRouteKm()));
    $("#route-count").text(n + " " + pluralStops(n));
  }

  /* ---------------- Tryb strefy (Turf.js) ---------------- */

  function exitZoneMode() {
    zoneMode = false;
    $("#zone-toggle").removeClass("btn--active");
    $("#zone-bar").prop("hidden", true);
    $("#zone-hint").prop("hidden", true);
    clearZone();
  }

  function toggleZoneMode() {
    if (zoneMode) {
      exitZoneMode();
      renderList();
      return;
    }
    exitOtherModes("zone");
    zoneMode = true;
    activeId = null;
    $("#zone-toggle").addClass("btn--active");
    $("#zone-bar").prop("hidden", false);
    $("#zone-hint").prop("hidden", false);
    updateZoneInfo();
    renderList();
  }

  function addZoneVertex(latlng) {
    zoneVertices.push([latlng.lat, latlng.lng]);
    var m = L.circleMarker([latlng.lat, latlng.lng], {
      radius: 5,
      color: "#7c3aed",
      fillColor: "#fff",
      fillOpacity: 1,
      weight: 2,
    }).addTo(map);
    zoneMarkers.push(m);
    drawZone();
    updateZoneInfo();
    renderList();
  }

  function drawZone() {
    if (zoneLayer) {
      map.removeLayer(zoneLayer);
      zoneLayer = null;
    }
    if (zoneVertices.length >= 3) {
      zoneLayer = L.polygon(zoneVertices, {
        color: "#7c3aed",
        weight: 2,
        fillColor: "#7c3aed",
        fillOpacity: 0.12,
      }).addTo(map);
    } else if (zoneVertices.length === 2) {
      zoneLayer = L.polyline(zoneVertices, {
        color: "#7c3aed",
        weight: 2,
        dashArray: "4,6",
      }).addTo(map);
    }
  }

  function clearZone() {
    zoneVertices = [];
    zoneMarkers.forEach(function (m) {
      map.removeLayer(m);
    });
    zoneMarkers = [];
    if (zoneLayer) {
      map.removeLayer(zoneLayer);
      zoneLayer = null;
    }
    zoneInsideIds = [];
    updateZoneInfo();
    renderList();
  }

  // Wierzchołki strefy -> zamknięty GeoJSON Polygon (dla Turf).
  function zonePolygon() {
    if (zoneVertices.length < 3) return null;
    var ring = zoneVertices.map(function (p) {
      return [p[1], p[0]]; // [lng, lat]
    });
    ring.push(ring[0]); // domknięcie pierścienia
    return turf.polygon([ring]);
  }

  function tasksInZone() {
    var poly = zonePolygon();
    if (!poly) return [];
    return TaskStore.all()
      .filter(function (t) {
        // TaskStore.toFeature(t) zwraca GeoJSON Point — wprost do Turf.
        return turf.booleanPointInPolygon(TaskStore.toFeature(t), poly);
      })
      .map(function (t) {
        return t.id;
      });
  }

  function updateZoneInfo() {
    zoneInsideIds = tasksInZone();
    var poly = zonePolygon();
    var area = poly ? turf.area(poly) : 0;
    $("#zone-area").text(formatArea(area));
    $("#zone-count").text(
      zoneInsideIds.length + " " + pluralTasks(zoneInsideIds.length) + " w strefie"
    );
  }

  /* ---------------- Tryb pomiaru (Turf.js) ---------------- */

  function exitMeasureMode() {
    measureMode = false;
    $("#measure-toggle").removeClass("btn--active");
    $("#measure-bar").prop("hidden", true);
    $("#measure-hint").prop("hidden", true);
    clearMeasure();
  }

  function toggleMeasureMode() {
    if (measureMode) {
      exitMeasureMode();
      return;
    }
    exitOtherModes("measure");
    measureMode = true;
    activeId = null;
    $("#measure-toggle").addClass("btn--active");
    $("#measure-bar").prop("hidden", false);
    $("#measure-hint").prop("hidden", false);
    updateMeasureInfo();
  }

  function addMeasurePoint(latlng) {
    measurePoints.push([latlng.lat, latlng.lng]);
    var n = measurePoints.length;
    var m = L.circleMarker([latlng.lat, latlng.lng], {
      radius: 5,
      color: "#0f8f78",
      fillColor: "#fff",
      fillOpacity: 1,
      weight: 2,
    })
      .addTo(map)
      .bindTooltip("Punkt " + n, { direction: "top", offset: [0, -6] });
    measureMarkers.push(m);
    drawMeasure();
    updateMeasureInfo();
  }

  function drawMeasure() {
    if (measureLayer) {
      map.removeLayer(measureLayer);
      measureLayer = null;
    }
    if (measurePoints.length >= 2) {
      measureLayer = L.polyline(measurePoints, {
        color: "#0f8f78",
        weight: 3,
        opacity: 0.9,
        dashArray: "6,6",
      }).addTo(map);
    }
  }

  function clearMeasure() {
    measurePoints = [];
    measureMarkers.forEach(function (m) {
      map.removeLayer(m);
    });
    measureMarkers = [];
    if (measureLayer) {
      map.removeLayer(measureLayer);
      measureLayer = null;
    }
    updateMeasureInfo();
  }

  // Łączna długość łamanej pomiaru (GeoJSON LineString -> turf.length).
  function computeMeasureKm() {
    if (measurePoints.length < 2) return 0;
    var lngLat = measurePoints.map(function (p) {
      return [p[1], p[0]];
    });
    return turf.length(turf.lineString(lngLat), { units: "kilometers" });
  }

  function updateMeasureInfo() {
    var n = measurePoints.length;
    $("#measure-distance").text(formatDistance(computeMeasureKm()));
    $("#measure-count").text(n + " " + pluralPoints(n));
  }

  /* ---------------- Przełączanie trybów ---------------- */

  // Wyłącza wszystkie tryby poza wskazanym (tryby wykluczają się wzajemnie).
  function exitOtherModes(except) {
    if (except !== "route" && routeMode) exitRouteMode();
    if (except !== "zone" && zoneMode) exitZoneMode();
    if (except !== "measure" && measureMode) exitMeasureMode();
  }

  /* ---------------- Modal (dodawanie / edycja) ---------------- */

  var $modal = null;
  var tempMarker = null;

  function clearTempMarker() {
    if (tempMarker) {
      map.removeLayer(tempMarker);
      tempMarker = null;
    }
  }

  function openModalForNew(lat, lng) {
    var $form = $("#task-form")[0];
    $form.reset();
    $form.id.value = "";
    $form.lat.value = lat;
    $form.lng.value = lng;
    $("#modal-title").text("Nowe zadanie");

    clearTempMarker();
    tempMarker = L.circleMarker([lat, lng], {
      radius: 6,
      color: "#2f6fed",
      fillColor: "#fff",
      fillOpacity: 1,
      weight: 2,
      dashArray: "3",
    }).addTo(map);

    showModal();
  }

  function openModalForEdit(id) {
    var task = TaskStore.get(id);
    if (!task) return;
    var $form = $("#task-form")[0];
    $form.reset();
    $form.id.value = task.id;
    $form.lat.value = task.lat;
    $form.lng.value = task.lng;
    $form.title.value = task.title;
    $form.description.value = task.description;
    $form.category.value = task.category;
    $form.priority.value = task.priority;
    $("#modal-title").text("Edytuj zadanie");
    showModal();
  }

  function showModal() {
    $modal.removeAttr("hidden");
    setTimeout(function () {
      $("#task-form").find('[name="title"]').trigger("focus");
    }, 0);
  }

  function hideModal() {
    $modal.attr("hidden", "hidden");
    clearTempMarker();
  }

  function handleSubmit(e) {
    e.preventDefault();
    var $form = $("#task-form")[0];
    var title = $form.title.value.trim();
    if (!title) return;

    var data = {
      title: title,
      description: $form.description.value.trim(),
      category: $form.category.value || CATEGORY_DEFAULT,
      priority: $form.priority.value || "sredni",
      lat: parseFloat($form.lat.value),
      lng: parseFloat($form.lng.value),
    };

    if ($form.id.value) {
      var updated = TaskStore.update($form.id.value, data);
      if (updated) {
        updateMarker(updated);
        if (routeOrder.indexOf(updated.id) !== -1) {
          drawRoute();
          updateRouteInfo();
        }
        if (zoneMode) updateZoneInfo();
      }
      hideModal();
      renderList();
    } else {
      var created = TaskStore.add(data);
      addMarker(created);
      hasInteracted = true;
      hideModal();
      renderList();
      focusTask(created.id, { gentle: true }); // bez szarpania widokiem
    }
  }

  /* ---------------- Akcje na zadaniach ---------------- */

  function toggleDone(id) {
    var task = TaskStore.get(id);
    if (!task) return;
    var updated = TaskStore.update(id, { done: !task.done });
    updateMarker(updated);
    if (zoneMode) updateZoneInfo();
    renderList();
  }

  function deleteTask(id) {
    var task = TaskStore.get(id);
    if (!task) return;
    var snapshot = $.extend({}, task);

    TaskStore.remove(id);
    removeMarker(id);
    if (activeId === id) activeId = null;
    removeFromRoute(id);
    if (zoneMode) updateZoneInfo();
    renderList();

    showUndoToast(snapshot);
  }

  function undoDelete(snapshot) {
    TaskStore.insert(snapshot);
    addMarker(snapshot);
    if (zoneMode) updateZoneInfo();
    renderList();
  }

  /* ---------------- Toast ---------------- */

  var toastTimer = null;

  function toast(msg) {
    var $t = $("#toast").empty().text(msg).addClass("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      $t.removeClass("is-show");
    }, 2600);
  }

  function showUndoToast(snapshot) {
    var $t = $("#toast").empty();
    $("<span></span>").text('Usunięto „' + snapshot.title + '”').appendTo($t);
    $('<button class="toast__action" type="button">Cofnij</button>')
      .on("click", function () {
        undoDelete(snapshot);
        $t.removeClass("is-show");
        clearTimeout(toastTimer);
      })
      .appendTo($t);
    $t.addClass("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      $t.removeClass("is-show");
    }, 5000);
  }

  /* ---------------- Bootstrap ---------------- */

  function loadExistingTasks() {
    TaskStore.all().forEach(addMarker);
  }

  function bindEvents() {
    // Lista: klik na karcie.
    $("#task-list").on("click", ".task-item", function (e) {
      if ($(e.target).closest(".task-item__check, [data-action]").length) return;
      var id = $(this).data("id");
      if (routeMode) toggleRouteStop(id);
      else setActive(id);
    });

    $("#task-list").on("change", ".task-item__check", function (e) {
      e.stopPropagation();
      toggleDone($(this).closest(".task-item").data("id"));
    });

    $("#task-list").on("click", '[data-action="edit"]', function (e) {
      e.stopPropagation();
      openModalForEdit($(this).closest(".task-item").data("id"));
    });
    $("#task-list").on("click", '[data-action="delete"]', function (e) {
      e.stopPropagation();
      deleteTask($(this).closest(".task-item").data("id"));
    });

    // Modal.
    $("#task-form").on("submit", handleSubmit);
    $modal.on("click", "[data-close]", function () {
      hideModal();
    });
    $(document).on("keydown", function (e) {
      if (e.key === "Escape" && !$modal.attr("hidden")) hideModal();
    });

    // Tryby.
    $("#route-toggle").on("click", toggleRouteMode);
    $("#route-clear").on("click", clearRoute);
    $("#zone-toggle").on("click", toggleZoneMode);
    $("#zone-clear").on("click", clearZone);
    $("#measure-toggle").on("click", toggleMeasureMode);
    $("#measure-clear").on("click", clearMeasure);

    // Zwijanie/rozwijanie panelu (bottom sheet na mobile).
    $("#sheet-handle").on("click", toggleSheet);

    // Narzędzia listy.
    $("#search").on("input", function () {
      searchQuery = $(this).val();
      renderList();
    });
    $("#filter").on("click", ".segmented__btn", function () {
      $("#filter .segmented__btn").removeClass("is-active");
      $(this).addClass("is-active");
      filterState = $(this).data("filter");
      renderList();
    });
    $("#sort").on("change", function () {
      sortBy = $(this).val();
      if (sortBy === "distance" && !userPos) {
        toast("Ustalam Twoją lokalizację…");
        locateUser({ center: false });
      }
      renderList();
    });

    // Lokalizacja.
    $("#locate-btn").on("click", function () {
      locateUser({ center: true });
    });
  }

  // Zwija/rozwija panel; po zmianie wysokości mapa musi przeliczyć rozmiar.
  function toggleSheet() {
    $("#sidebar").toggleClass("is-collapsed");
    setTimeout(function () {
      map.invalidateSize();
    }, 280);
  }

  /* ---------------- Narzędzia ---------------- */

  function formatDistance(km) {
    if (km < 1) return Math.round(km * 1000) + " m";
    return km.toFixed(2).replace(".", ",") + " km";
  }

  function formatArea(m2) {
    if (m2 >= 1e6) return (m2 / 1e6).toFixed(2).replace(".", ",") + " km²";
    return Math.round(m2).toLocaleString("pl-PL") + " m²";
  }

  function pluralStops(n) {
    if (n === 1) return "przystanek";
    var last = n % 10;
    var tens = n % 100;
    if (last >= 2 && last <= 4 && (tens < 10 || tens >= 20)) return "przystanki";
    return "przystanków";
  }

  function pluralTasks(n) {
    if (n === 1) return "zadanie";
    var last = n % 10;
    var tens = n % 100;
    if (last >= 2 && last <= 4 && (tens < 10 || tens >= 20)) return "zadania";
    return "zadań";
  }

  function pluralPoints(n) {
    if (n === 1) return "punkt";
    var last = n % 10;
    var tens = n % 100;
    if (last >= 2 && last <= 4 && (tens < 10 || tens >= 20)) return "punkty";
    return "punktów";
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  $(function () {
    $modal = $("#task-modal");
    initMap();
    loadExistingTasks();
    renderList();
    bindEvents();
    initialView();
  });
})();
