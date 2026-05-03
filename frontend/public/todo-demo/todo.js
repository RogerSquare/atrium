(() => {
  const STORAGE_KEY = 'todoDemoItems';

  const app = document.querySelector('.app');
  const form = document.querySelector('[data-testid="todo-form"]');
  const input = document.querySelector('[data-testid="todo-input"]');
  const list = document.querySelector('[data-testid="todo-list"]');
  const count = document.querySelector('[data-testid="todo-count"]');
  const filterButtons = document.querySelectorAll('[data-filter-value]');

  let items = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function nextId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function render() {
    list.replaceChildren(...items.map(renderItem));
    const active = items.filter((i) => !i.completed).length;
    count.textContent = `${active} ${active === 1 ? 'item' : 'items'} left`;
  }

  function renderItem(item) {
    const li = document.createElement('li');
    li.className = 'item';
    li.dataset.testid = 'todo-item';
    li.dataset.id = item.id;
    li.dataset.completed = String(item.completed);

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = item.completed;
    toggle.dataset.testid = 'todo-toggle';
    toggle.setAttribute('aria-label', `Mark "${item.text}" as ${item.completed ? 'active' : 'completed'}`);
    toggle.addEventListener('change', () => {
      item.completed = toggle.checked;
      save();
      render();
    });

    const label = document.createElement('span');
    label.className = 'label';
    label.dataset.testid = 'todo-label';
    label.textContent = item.text;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.dataset.testid = 'todo-delete';
    del.setAttribute('aria-label', `Delete "${item.text}"`);
    del.textContent = '×';
    del.addEventListener('click', () => {
      items = items.filter((i) => i.id !== item.id);
      save();
      render();
    });

    li.append(toggle, label, del);
    return li;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    items.push({ id: nextId(), text, completed: false });
    input.value = '';
    save();
    render();
    input.focus();
  });

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.filterValue;
      app.dataset.filter = value;
      filterButtons.forEach((b) => {
        b.setAttribute('aria-selected', String(b === btn));
      });
    });
  });

  render();
})();
