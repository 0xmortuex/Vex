// === Vex Phase 15: Personas settings UI ===

const PersonasSettings = (() => {

  function toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function renderPanel(container) {
    if (!container) container = document.getElementById('personas-panel-content');
    if (!container) return;
    const personas = PersonasManager.getAll();
    container.innerHTML = `
      <div class="personas-panel">
        <div class="panel-header">
          <h2 style="font-size:18px;margin:0 0 6px 0">\ud83c\udfad AI Personas</h2>
          <p class="panel-desc">Create specialized AI assistants with custom instructions. Type <code>@name</code> in chat to switch instantly.</p>
        </div>
        <div class="panel-actions">
          <button class="btn-primary" id="btn-new-persona">+ New Persona</button>
          <button class="btn-secondary" id="btn-import-persona">Import</button>
          <button class="btn-secondary" id="btn-export-personas">Export All</button>
        </div>
        <div class="personas-grid">
          ${personas.map(renderPersonaCard).join('')}
        </div>
      </div>
    `;
    wireHandlers(container);
  }

  function renderPersonaCard(persona) {
    const prompt = persona.systemPrompt || '';
    const preview = prompt.length > 140 ? prompt.substring(0, 140) + '\u2026' : prompt;
    const backendIcon = persona.preferredBackend === 'local' ? '\ud83d\udd12'
                       : persona.preferredBackend === 'cloud' ? '\u2601\ufe0f' : '\u2699\ufe0f';
    return `
      <div class="persona-card ${persona.isBuiltIn ? 'builtin' : ''}" data-persona-id="${escapeHtml(persona.id)}">
        <div class="persona-card-header">
          <span class="persona-card-icon">${escapeHtml(persona.icon)}</span>
          <div class="persona-card-info">
            <div class="persona-card-name">${escapeHtml(persona.name)}</div>
            <div class="persona-card-desc">${escapeHtml(persona.description || '')}</div>
          </div>
          ${persona.isBuiltIn ? '<span class="persona-badge">built-in</span>' : ''}
        </div>
        <div class="persona-card-prompt">${escapeHtml(preview)}</div>
        <div class="persona-card-meta">
          <span class="meta-item">\ud83c\udf21\ufe0f ${persona.temperature}</span>
          <span class="meta-item">${backendIcon} ${escapeHtml(persona.preferredBackend)}</span>
          <span class="meta-item">${(persona.quickPrompts || []).length} prompts</span>
        </div>
        <div class="persona-card-actions">
          <button class="btn-secondary-sm" data-action="edit">Edit</button>
          <button class="btn-secondary-sm" data-action="duplicate">Duplicate</button>
          ${!persona.isBuiltIn ? '<button class="btn-danger-sm" data-action="delete">Delete</button>' : ''}
          <button class="btn-primary-sm" data-action="activate">Use</button>
        </div>
      </div>
    `;
  }

  function wireHandlers(container) {
    document.getElementById('btn-new-persona')?.addEventListener('click', () => showPersonaEditor(null));

    document.getElementById('btn-export-personas')?.addEventListener('click', () => {
      const data = PersonasManager.exportPersonas();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vex-personas-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Personas exported', 'success');
    });

    document.getElementById('btn-import-persona')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          const count = PersonasManager.importPersonas(data);
          toast(`Imported ${count} persona${count === 1 ? '' : 's'}`, 'success');
          renderPanel(container);
        } catch (err) {
          toast(`Import failed: ${err.message}`, 'error');
        }
      });
      input.click();
    });

    container.querySelectorAll('.persona-card').forEach(card => {
      const personaId = card.dataset.personaId;
      card.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
        showPersonaEditor(PersonasManager.getById(personaId));
      });
      card.querySelector('[data-action="duplicate"]')?.addEventListener('click', () => {
        PersonasManager.duplicate(personaId);
        toast('Duplicated', 'success');
        renderPanel(container);
      });
      card.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        const p = PersonasManager.getById(personaId);
        if (!confirm(`Delete "${p.name}"?`)) return;
        PersonasManager.remove(personaId);
        toast('Deleted', 'success');
        renderPanel(container);
      });
      card.querySelector('[data-action="activate"]')?.addEventListener('click', () => {
        const tab = (typeof TabManager !== 'undefined') ? TabManager.getActiveTab() : null;
        PersonasManager.setActiveForTab(tab?.id, personaId);
        if (typeof AIPanel !== 'undefined' && typeof AIPanel.updatePersonaSwitcher === 'function') {
          AIPanel.updatePersonaSwitcher();
        }
        toast(`Using ${PersonasManager.getById(personaId).name}`, 'success');
      });
    });
  }

  function showPersonaEditor(existing) {
    const isEdit = !!existing;
    const p = existing || {
      name: '', description: '', icon: '\ud83e\udd16', systemPrompt: '',
      temperature: 0.7, preferredBackend: 'auto',
      tabContextDefault: 'current', responseFormat: 'prose',
      suggestedFollowUps: true, quickPrompts: []
    };

    const overlay = document.createElement('div');
    overlay.className = 'sync-modal-overlay';
    overlay.innerHTML = `
      <div class="sync-modal-card persona-editor">
        <h2 style="margin-top:0">${isEdit ? (existing.isBuiltIn ? 'Fork Built-in Persona' : 'Edit Persona') : 'New Persona'}</h2>
        ${existing && existing.isBuiltIn ? '<p class="panel-desc" style="color:var(--text-muted);font-size:12px;margin:-4px 0 14px">Built-ins can\'t be edited directly. Saving will create an editable custom copy.</p>' : ''}

        <div class="form-row">
          <div class="form-field" style="flex:0 0 80px">
            <label>Icon</label>
            <input type="text" id="pe-icon" value="${escapeHtml(p.icon)}" maxlength="4" style="text-align:center;font-size:22px">
          </div>
          <div class="form-field" style="flex:1">
            <label>Name</label>
            <input type="text" id="pe-name" value="${escapeHtml(p.name)}" placeholder="e.g., Research Vex">
          </div>
        </div>

        <div class="form-field">
          <label>Description <span class="hint">(shown in switcher)</span></label>
          <input type="text" id="pe-description" value="${escapeHtml(p.description)}" placeholder="What does this persona help with?">
        </div>

        <div class="form-field">
          <label>System Prompt <span class="hint">(instructions for the AI)</span></label>
          <textarea id="pe-prompt" rows="10" placeholder="You are [persona name]. Your job is to...">${escapeHtml(p.systemPrompt)}</textarea>
        </div>

        <div class="form-row">
          <div class="form-field" style="flex:1">
            <label>Temperature <span class="hint">(0 = focused, 1 = creative)</span></label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="range" id="pe-temperature" min="0" max="1" step="0.1" value="${p.temperature}" style="flex:1">
              <span id="pe-temp-value" style="font-family:'JetBrains Mono',monospace;min-width:30px;text-align:right">${p.temperature}</span>
            </div>
          </div>
          <div class="form-field" style="flex:1">
            <label>Preferred AI Backend</label>
            <select id="pe-backend">
              <option value="auto" ${p.preferredBackend === 'auto' ? 'selected' : ''}>Auto</option>
              <option value="cloud" ${p.preferredBackend === 'cloud' ? 'selected' : ''}>Cloud (Claude)</option>
              <option value="local" ${p.preferredBackend === 'local' ? 'selected' : ''}>Local (Ollama)</option>
            </select>
          </div>
        </div>

        <div class="form-field">
          <label>Quick Prompts <span class="hint">(one per line, max 5 &mdash; appear as buttons)</span></label>
          <textarea id="pe-prompts" rows="4" placeholder="Summarize this page&#10;Explain in simple terms&#10;Find the key argument">${escapeHtml((p.quickPrompts || []).join('\n'))}</textarea>
        </div>

        <details class="advanced-section">
          <summary>Advanced</summary>
          <div class="form-field">
            <label>Default tab context</label>
            <select id="pe-context">
              <option value="current" ${p.tabContextDefault === 'current' ? 'selected' : ''}>Current tab</option>
              <option value="all" ${p.tabContextDefault === 'all' ? 'selected' : ''}>All open tabs</option>
              <option value="group" ${p.tabContextDefault === 'group' ? 'selected' : ''}>Current group</option>
              <option value="none" ${p.tabContextDefault === 'none' ? 'selected' : ''}>No context</option>
            </select>
          </div>
          <div class="form-field">
            <label style="display:flex;align-items:center;gap:8px">
              <input type="checkbox" id="pe-followups" ${p.suggestedFollowUps ? 'checked' : ''}>
              Suggest follow-up questions
            </label>
          </div>
        </details>

        <div class="modal-actions" style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
          <button class="btn-secondary" id="pe-cancel">Cancel</button>
          <button class="btn-primary" id="pe-save">${isEdit && !existing.isBuiltIn ? 'Save Changes' : 'Create Persona'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('pe-temperature').addEventListener('input', (e) => {
      document.getElementById('pe-temp-value').textContent = e.target.value;
    });
    document.getElementById('pe-cancel').addEventListener('click', () => overlay.remove());
    document.getElementById('pe-save').addEventListener('click', () => {
      const data = {
        name: document.getElementById('pe-name').value.trim(),
        description: document.getElementById('pe-description').value.trim(),
        icon: document.getElementById('pe-icon').value.trim() || '\ud83e\udd16',
        systemPrompt: document.getElementById('pe-prompt').value.trim(),
        temperature: parseFloat(document.getElementById('pe-temperature').value),
        preferredBackend: document.getElementById('pe-backend').value,
        tabContextDefault: document.getElementById('pe-context').value,
        suggestedFollowUps: document.getElementById('pe-followups').checked,
        quickPrompts: document.getElementById('pe-prompts').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 5)
      };
      if (!data.name) { toast('Name required', 'warn'); return; }
      if (!data.systemPrompt) { toast('System prompt required', 'warn'); return; }

      if (isEdit && !existing.isBuiltIn) {
        PersonasManager.update(existing.id, data);
        toast('Persona updated', 'success');
      } else {
        const created = PersonasManager.create(data);
        toast(`Persona "${created.name}" created`, 'success');
      }
      overlay.remove();
      renderPanel(document.getElementById('personas-panel-content'));
      if (typeof AIPanel !== 'undefined' && typeof AIPanel.updatePersonaSwitcher === 'function') {
        AIPanel.updatePersonaSwitcher();
      }
    });
  }

  return { renderPanel, showPersonaEditor };
})();

window.PersonasSettings = PersonasSettings;
