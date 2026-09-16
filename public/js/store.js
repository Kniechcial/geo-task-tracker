/* GeoTasker — warstwa danych.
   CRUD na zadaniach + trwałość w localStorage + konwersja do GeoJSON (dla Turf). */

var TaskStore = (function () {
  "use strict";

  var STORAGE_KEY = "geotasker.tasks.v1";
  var tasks = load();

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
      // np. tryb prywatny / brak miejsca — aplikacja działa dalej bez zapisu.
    }
  }

  function uid() {
    return (
      "t_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 7)
    );
  }

  function all() {
    return tasks.slice();
  }

  function get(id) {
    return tasks.filter(function (t) {
      return t.id === id;
    })[0];
  }

  function add(data) {
    var task = {
      id: uid(),
      title: data.title,
      description: data.description || "",
      category: data.category || "Inne",
      priority: data.priority || "sredni",
      done: false,
      lat: data.lat,
      lng: data.lng,
      createdAt: Date.now(),
    };
    tasks.push(task);
    persist();
    return task;
  }

  function update(id, patch) {
    var task = get(id);
    if (!task) return null;
    Object.keys(patch).forEach(function (key) {
      task[key] = patch[key];
    });
    persist();
    return task;
  }

  function remove(id) {
    tasks = tasks.filter(function (t) {
      return t.id !== id;
    });
    persist();
  }

  // Zadanie -> GeoJSON Feature (Point). Uwaga: GeoJSON ma kolejność [lng, lat].
  function toFeature(task) {
    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [task.lng, task.lat],
      },
      properties: {
        id: task.id,
        title: task.title,
        category: task.category,
        priority: task.priority,
        done: task.done,
      },
    };
  }

  // Wszystkie zadania -> GeoJSON FeatureCollection (wejście dla Turf.js).
  function toFeatureCollection() {
    return {
      type: "FeatureCollection",
      features: tasks.map(toFeature),
    };
  }

  return {
    all: all,
    get: get,
    add: add,
    update: update,
    remove: remove,
    toFeature: toFeature,
    toFeatureCollection: toFeatureCollection,
  };
})();
