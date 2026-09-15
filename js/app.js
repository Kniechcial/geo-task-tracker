/* GeoTasker — logika aplikacji.
   Mapa + geolokalizacja, dodawanie zadań klikiem, lista w panelu,
   dwukierunkowe bindowanie lista <-> mapa, CRUD (przez TaskStore). */

(function () {
  "use strict";

  var DEFAULT_CENTER = [50.0647, 19.945]; // Kraków
  var DEFAULT_ZOOM = 13;

  var CATEGORY_DEFAULT = "Inne";
  var PRIORITY_LABEL = { wysoki: "Wysoki", sredni: "Średni", niski: "Niski" };

  var map;
  var userMarker;
  var markers = {}; // id zadania -> Leaflet marker
  var activeId = null; // aktualnie podświetlone zadanie

  var routeMode = false;
  var routeOrder = []; // id zadań w kolejności trasy
  var routeLayer = null; // polilinia trasy na mapie

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

    // Klik na pustej mapie = nowe zadanie (wyłączone w trybie trasy).
    map.on("click", function (e) {
      if (routeMode) return;
      openModalForNew(e.latlng.lat, e.latlng.lng);
    });
  }

  function showUserLocation(lat, lng, options) {
    options = options || {};
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

    if (options.center !== false) {
      map.setView(latlng, Math.max(map.getZoom(), 14));
    }
  }

  function locateUser(options) {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        showUserLocation(pos.coords.latitude, pos.coords.longitude, options);
      },
      function () {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  /* ---------------- Markery ---------------- */

  // orderNum (opcjonalnie): numer przystanku w trasie — pokazywany na pinezce.
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
    var html =
      '<strong>' + escapeHtml(task.title) + "</strong>";
    if (task.description) {
      html += '<br><span style="color:#6b7684">' +
        escapeHtml(task.description) + "</span>";
    }
    html +=
      '<br><small>' +
      escapeHtml(task.category) +
      " · " +
      (PRIORITY_LABEL[task.priority] || task.priority) +
      (task.done ? " · ukończone" : "") +
      "</small>";
    return html;
  }

  function addMarker(task) {
    var marker = L.marker([task.lat, task.lng], {
      icon: makeIcon(task),
    })
      .addTo(map)
      .bindPopup(popupHtml(task));

    marker.on("click", function () {
      if (routeMode) toggleRouteStop(task.id);
      else setActive(task.id);
    });

    markers[task.id] = marker;
  }

  // Odświeża ikony wszystkich markerów wg aktualnej kolejności trasy.
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

  function renderList() {
    var tasks = TaskStore.all();
    var $list = $("#task-list").empty();

    if (tasks.length === 0) {
      $list.html(
        '<p class="empty-state">Kliknij na mapie, aby dodać pierwsze zadanie.</p>'
      );
      return;
    }

    tasks.forEach(function (task) {
      $list.append(buildTaskItem(task));
    });
  }

  function buildTaskItem(task) {
    var routeIdx = routeOrder.indexOf(task.id);
    var $item = $('<div class="task-item"></div>')
      .attr("data-id", task.id)
      .toggleClass("is-done", !!task.done)
      .toggleClass("is-active", task.id === activeId)
      .toggleClass("in-route", routeIdx !== -1);

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
      $('<span class="order-badge"></span>')
        .text(routeIdx + 1)
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

  /* ---------------- Dwukierunkowe bindowanie ---------------- */

  function setActive(id) {
    activeId = id;
    $(".task-item").removeClass("is-active");
    var $item = $('.task-item[data-id="' + id + '"]').addClass("is-active");

    // Przewiń listę do zaznaczonego elementu.
    if ($item.length) {
      $item[0].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    var task = TaskStore.get(id);
    if (task && markers[id]) {
      map.setView([task.lat, task.lng], Math.max(map.getZoom(), 15), {
        animate: true,
      });
      markers[id].openPopup();
    }
  }

  /* ---------------- Tryb trasy (Turf.js) ---------------- */

  function toggleRouteMode() {
    routeMode = !routeMode;
    $("#route-toggle")
      .toggleClass("btn--active", routeMode)
      .text(routeMode ? "Zakończ trasę" : "Tryb trasy");
    $("#route-bar").prop("hidden", !routeMode);
    $("#route-hint").prop("hidden", !routeMode);

    if (routeMode) {
      activeId = null;
      $(".task-item").removeClass("is-active");
    } else {
      clearRoute();
    }
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

  // Współrzędne przystanków w kolejności trasy.
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

  // Rzeczywista długość trasy liczona przez Turf (GeoJSON LineString).
  function computeRouteKm() {
    var lngLat = routeOrder
      .map(function (id) {
        var t = TaskStore.get(id);
        return t ? [t.lng, t.lat] : null; // GeoJSON: [lng, lat]
      })
      .filter(Boolean);
    if (lngLat.length < 2) return 0;
    return turf.length(turf.lineString(lngLat), { units: "kilometers" });
  }

  function formatDistance(km) {
    if (km < 1) return Math.round(km * 1000) + " m";
    return km.toFixed(2).replace(".", ",") + " km";
  }

  function pluralStops(n) {
    if (n === 1) return "przystanek";
    var last = n % 10;
    var tens = n % 100;
    if (last >= 2 && last <= 4 && (tens < 10 || tens >= 20)) return "przystanki";
    return "przystanków";
  }

  function updateRouteInfo() {
    var n = routeOrder.length;
    $("#route-distance").text(formatDistance(computeRouteKm()));
    $("#route-count").text(n + " " + pluralStops(n));
  }

  /* ---------------- Modal (dodawanie / edycja) ---------------- */

  var $modal = null;
  var tempMarker = null; // podgląd lokalizacji dla nowego zadania

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
      }
    } else {
      var created = TaskStore.add(data);
      addMarker(created);
      activeId = created.id;
    }

    hideModal();
    renderList();
    if (activeId) setActive(activeId);
  }

  /* ---------------- Akcje na zadaniach ---------------- */

  function toggleDone(id) {
    var task = TaskStore.get(id);
    if (!task) return;
    var updated = TaskStore.update(id, { done: !task.done });
    updateMarker(updated);
    renderList();
    if (activeId) $('.task-item[data-id="' + activeId + '"]').addClass("is-active");
  }

  function deleteTask(id) {
    var task = TaskStore.get(id);
    if (!task) return;
    if (!window.confirm('Usunąć zadanie "' + task.title + '"?')) return;
    TaskStore.remove(id);
    removeMarker(id);
    if (activeId === id) activeId = null;

    var ri = routeOrder.indexOf(id);
    if (ri !== -1) {
      routeOrder.splice(ri, 1);
      drawRoute();
      refreshMarkerIcons();
      updateRouteInfo();
    }
    renderList();
  }

  /* ---------------- Bootstrap ---------------- */

  function loadExistingTasks() {
    TaskStore.all().forEach(addMarker);
  }

  function bindEvents() {
    // Lista: klik na karcie = zaznacz (lub dodaj/usuń przystanek w trybie trasy).
    $("#task-list").on("click", ".task-item", function (e) {
      if ($(e.target).closest(".task-item__check, [data-action]").length) return;
      var id = $(this).data("id");
      if (routeMode) toggleRouteStop(id);
      else setActive(id);
    });

    // Checkbox "wykonane".
    $("#task-list").on("change", ".task-item__check", function (e) {
      e.stopPropagation();
      toggleDone($(this).closest(".task-item").data("id"));
    });

    // Edycja / usuwanie.
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

    // Tryb trasy.
    $("#route-toggle").on("click", toggleRouteMode);
    $("#route-clear").on("click", clearRoute);

    // Przycisk lokalizacji.
    $("#locate-btn").on("click", function () {
      locateUser({ center: true });
    });
  }

  /* ---------------- Narzędzia ---------------- */

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
    locateUser();
  });
})();
