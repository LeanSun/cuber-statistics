/* ============================================================
   groups.js — 自定义项目分组（存 localStorage）
   ============================================================ */
(function () {
  const KEY = 'goat-evgroups-v1';
  let list = [];
  try {
    const s = localStorage.getItem(KEY);
    if (s) list = JSON.parse(s) || [];
  } catch (e) { }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { } }
  function all() { return list.slice(); }
  function add(name, ids) {
    const g = { id: 'u' + Date.now().toString(36), zh: name, en: name, ids: ids.slice(), custom: true };
    list.push(g); save(); return g;
  }
  function remove(id) { list = list.filter(function (g) { return g.id !== id; }); save(); }
  window.EvGroups = { all: all, add: add, remove: remove };
})();
