// ===================== POKEMON LEAGUE — WEB DASHBOARD =====================

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
const SPRITE_SHINY_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/';

let allUsers = [];
let currentTrainer = null;
let currentBox = 0;

// ===================== INIT =====================

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    await loadTrainers();

    // Auto-refresh every 15 seconds
    setInterval(async () => {
        if (!currentTrainer) {
            await loadTrainers();
        } else {
            await refreshCurrentTrainer();
        }
    }, 15000);
});

async function loadTrainers() {
    try {
        const res = await fetch('/api/users');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        allUsers = await res.json();
        renderTrainers();
        renderRankings();
        renderRoutes();
        document.getElementById('loading').classList.add('hidden');
    } catch (err) {
        console.error('Error loading trainers:', err);
        document.getElementById('loading').innerHTML = `
            <div style="text-align:center;color:#ff4757;">
                <p style="font-size:1.2rem;margin-bottom:8px;">❌ Error cargando entrenadores</p>
                <p style="font-size:0.85rem;color:#a0a0c0;">${err.message}</p>
            </div>
        `;
    }
}

async function refreshCurrentTrainer() {
    if (!currentTrainer) return;
    try {
        const res = await fetch(`/api/users/${currentTrainer.id}`);
        if (res.ok) {
            const data = await res.json();
            currentTrainer = data;
            renderTrainerDetail(data);
        }
    } catch (err) {
        console.error('Error refreshing trainer:', err);
    }
}

// ===================== RENDER TRAINERS LIST =====================

function renderTrainers() {
    const grid = document.getElementById('trainers-grid');
    document.getElementById('trainer-count').textContent = allUsers.length;

    if (allUsers.length === 0) {
        grid.innerHTML = `
            <div class="no-data-msg" style="grid-column:1/-1">
                <span class="icon">🏟️</span>
                <p>Aún no hay entrenadores registrados</p>
                <p style="font-size:0.85rem;margin-top:8px;color:var(--text-muted)">Conecta la app de escritorio para sincronizar tu partida</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = '';
    allUsers.forEach(user => {
        const card = document.createElement('div');
        card.className = 'trainer-card';

        const party = user.party || [];
        const boxes = user.boxes || [];
        const nuzlocke = user.nuzlocke || { deaths: [] };
        const boxCount = boxes.reduce((s, b) => s + ((b.slots || []).filter(Boolean).length), 0);
        const partyCount = party.length;
        const deathCount = nuzlocke.deaths ? nuzlocke.deaths.length : 0;

        const updatedAt = user.updated_at
            ? new Date(user.updated_at).toLocaleDateString('es-ES', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            })
            : 'Sin datos';

        const initial = user.username.charAt(0).toUpperCase();

        // Party preview sprites
        const partyPreviewHTML = party.slice(0, 6).map(p =>
            `<img src="${getSpriteUrl(p.speciesId, p.isShiny)}" alt="${escapeHtml(p.species)}" title="${escapeHtml(p.nickname || p.species)} Lv.${p.level}" width="48" height="48" onerror="this.src='${SPRITE_BASE}0.png'">`
        ).join('');

        card.innerHTML = `
            <div class="trainer-header">
                <div class="trainer-avatar">${initial}</div>
                <div>
                    <div class="trainer-name">${escapeHtml(user.username)}</div>
                    <div class="trainer-meta">Última sync: ${updatedAt}</div>
                </div>
            </div>
            ${partyPreviewHTML ? `<div class="trainer-party-preview">${partyPreviewHTML}</div>` : ''}
            <div class="trainer-stats">
                <span>⚔️ ${partyCount} en equipo</span>
                <span>📦 ${boxCount} en PC</span>
                ${deathCount > 0 ? `<span>💀 ${deathCount} caídos</span>` : ''}
            </div>
        `;

        card.addEventListener('click', () => viewTrainer(user));
        grid.appendChild(card);
    });
}

// ===================== VIEW TRAINER DETAIL =====================

function viewTrainer(user) {
    currentTrainer = user;
    currentBox = 0;
    document.getElementById('trainers-section').style.display = 'none';
    document.getElementById('detail-section').style.display = 'block';
    renderTrainerDetail(user);
}

function showTrainerList() {
    currentTrainer = null;
    document.getElementById('trainers-section').style.display = 'block';
    document.getElementById('detail-section').style.display = 'none';
    loadTrainers();
}

// ===================== KALOS BADGES =====================

const KALOS_BADGES = [
    { name: 'Escarabajo', img: '/badges/Medalla1.png' },
    { name: 'Muro',       img: '/badges/Medalla2.png' },
    { name: 'Combate',    img: '/badges/Medalla3.png' },
    { name: 'Planta',     img: '/badges/Medalla4.png' },
    { name: 'Voltaje',    img: '/badges/Medalla5.png' },
    { name: 'Hada',       img: '/badges/Medalla6.png' },
    { name: 'Psíquico',   img: '/badges/Medalla7.png' },
    { name: 'Iceberg',    img: '/badges/Medalla8.png' },
];

let activeDetailTab = 'actual';

function renderTrainerDetail(user) {
    const detail = document.getElementById('trainer-detail');
    const party = user.party || [];
    const boxes = user.boxes || [];
    const nuzlocke = user.nuzlocke || { deaths: [] };

    const initial = user.username.charAt(0).toUpperCase();
    const updatedAt = user.updated_at
        ? new Date(user.updated_at).toLocaleDateString('es-ES', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        })
        : 'Sin datos';

    detail.innerHTML = `
        <div class="detail-header">
            <div class="detail-avatar">${initial}</div>
            <div>
                <div class="trainer-name">${escapeHtml(user.username)}</div>
                <div class="trainer-meta">Última sincronización: ${updatedAt}</div>
            </div>
        </div>

        <!-- Tabs -->
        <div class="detail-tabs">
            <button class="detail-tab${activeDetailTab === 'actual' ? ' active' : ''}" data-tab="actual" onclick="switchDetailTab('actual')">🎖️ Actual</button>
            <button class="detail-tab${activeDetailTab === 'pokemon' ? ' active' : ''}" data-tab="pokemon" onclick="switchDetailTab('pokemon')">⚔️ Pokémon</button>
        </div>

        <!-- Tab: Actual -->
        <div class="tab-content" id="tab-actual" style="${activeDetailTab === 'actual' ? '' : 'display:none'}">
            <div id="actual-content"></div>
        </div>

        <!-- Tab: Pokémon -->
        <div class="tab-content" id="tab-pokemon" style="${activeDetailTab === 'pokemon' ? '' : 'display:none'}">
            <section class="party-section">
                <div class="section-title">
                    <span class="icon">⚔️</span>
                    <span>Equipo Actual</span>
                    <span class="count">${party.length}/6</span>
                </div>
                <div class="party-grid" id="detail-party-grid"></div>
            </section>
            <section class="box-section">
                <div class="section-title">
                    <span class="icon">📦</span>
                    <span>Cajas del PC</span>
                    <span class="count" id="detail-box-total">0 Pokémon</span>
                </div>
                <div class="box-tabs" id="detail-box-tabs"></div>
                <div class="box-grid" id="detail-box-grid"></div>
            </section>
            <section class="graveyard-section" id="detail-graveyard" style="display:none">
                <div class="section-title">
                    <span class="icon">💀</span>
                    <span>Cementerio</span>
                    <span class="count" id="detail-graveyard-count">0</span>
                </div>
                <div class="graveyard-grid" id="detail-graveyard-grid"></div>
            </section>
        </div>
    `;

    renderActualContent(user);
    renderDetailParty(party);
    renderDetailBoxTabs(boxes);
    renderDetailBox(0, boxes);
    renderDetailGraveyard(nuzlocke);
}

function switchDetailTab(tab) {
    activeDetailTab = tab;
    document.querySelectorAll('.detail-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.getElementById('tab-actual').style.display = tab === 'actual' ? 'block' : 'none';
    document.getElementById('tab-pokemon').style.display = tab === 'pokemon' ? 'block' : 'none';
}

function renderActualContent(user) {
    const container = document.getElementById('actual-content');
    if (!container) return;

    const trainer = user.trainer || {};
    const party = user.party || [];
    const nuzlocke = user.nuzlocke || { deaths: [] };
    const deaths = nuzlocke.deaths || [];
    const badges = trainer.badges || [];

    const trainerName = trainer.name || user.username;
    const initial = trainerName.charAt(0).toUpperCase();
    const tid = trainer.tid || '---';
    const hours = String(trainer.hours || 0).padStart(2, '0');
    const minutes = String(trainer.minutes || 0).padStart(2, '0');
    const seconds = String(trainer.seconds || 0).padStart(2, '0');
    const money = (trainer.money || 0).toLocaleString();
    const badgeCount = trainer.badgeCount || badges.filter(Boolean).length;

    // Points & challenges calculation
    const stats = getTrainerStats(user);
    const earnedFromBadges = (stats.badges * 100);
    let speciesMilestones = 0;
    [10, 25, 50, 100].forEach(t => { if (stats.uniqueSpecies >= t) speciesMilestones++; });
    const earnedFromSpecies = speciesMilestones * 100;
    const deathPenalty = stats.deaths * 50;

    const badgesHTML = KALOS_BADGES.map((badge, i) => {
        const earned = badges[i] || false;
        return `<div class="badge-item${earned ? ' earned' : ''}">
            <img class="badge-icon" src="${badge.img}" alt="${badge.name}" />
            <span class="badge-label">${badge.name}</span>
        </div>`;
    }).join('');

    const partyHTML = party.map(poke => {
        if (!poke) return '';
        const spriteUrl = getSpriteUrl(poke.speciesId, poke.isShiny);
        return `<div class="actual-party-card${poke.isShiny ? ' shiny' : ''}${poke.isDead ? ' dead' : ''}">
            <img src="${spriteUrl}" alt="${escapeHtml(poke.species)}" width="56" height="56" style="image-rendering:pixelated" onerror="this.src='${SPRITE_BASE}0.png'" />
            <div class="actual-party-info">
                <span class="actual-party-name">${escapeHtml(poke.nickname || poke.species)}</span>
                <span class="actual-party-level">Lv. ${poke.level}</span>
            </div>
        </div>`;
    }).join('');

    const deathsHTML = deaths.map(d => {
        const spriteUrl = getSpriteUrl(d.speciesId, d.isShiny);
        const date = new Date(d.diedAt);
        const timeStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        return `<div class="actual-death-card">
            <img src="${spriteUrl}" alt="${escapeHtml(d.species)}" width="48" height="48" style="image-rendering:pixelated" onerror="this.src='${SPRITE_BASE}0.png'" />
            <div class="actual-death-info">
                <span class="actual-death-name">${escapeHtml(d.nickname || d.species)}</span>
                <span class="actual-death-level">Lv. ${d.level}</span>
                <span class="actual-death-date">🕊️ ${timeStr}</span>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = `
        <div class="actual-trainer-card">
            <div class="actual-trainer-avatar">${initial}</div>
            <div class="actual-trainer-info">
                <div class="actual-trainer-name">${escapeHtml(trainerName)}</div>
                <div class="actual-trainer-meta">
                    <span>TID: ${tid}</span>
                    <span>🕐 ${hours}:${minutes}:${seconds}</span>
                </div>
                <div class="actual-trainer-money">💰 $${money}</div>
            </div>
        </div>

        <section class="detail-points-panel">
            <div class="detail-points-header">
                <span>🏆</span>
                <span>Puntos Nuzlocke</span>
            </div>
            <div class="detail-points-total">${stats.points}</div>
            <div class="detail-points-breakdown">
                <div class="detail-points-item earned">🏅 Medallas: +${earnedFromBadges}</div>
                <div class="detail-points-item earned">📖 Especies (${stats.uniqueSpecies}): +${earnedFromSpecies}</div>
                <div class="detail-points-item penalty">💀 Muertes (${stats.deaths}): -${deathPenalty}</div>
            </div>
            ${stats.shinys > 0 ? `<div class="detail-points-shiny">✨ Shinys encontrados: ${stats.shinys}</div>` : ''}
        </section>

        <section class="actual-badges-section">
            <div class="section-title">
                <span class="icon">🏅</span>
                <span>Medallas de Kalos</span>
                <span class="count">${badgeCount}/8</span>
            </div>
            <div class="badges-grid">${badgesHTML}</div>
        </section>

        <section class="actual-party-section">
            <div class="section-title">
                <span class="icon">⚔️</span>
                <span>Equipo</span>
                <span class="count">${party.length}/6</span>
            </div>
            <div class="actual-party-grid">${partyHTML || '<div class="no-data-msg"><span class="icon">🎒</span><p>Sin Pokémon en el equipo</p></div>'}</div>
        </section>

        ${deaths.length > 0 ? `
        <section class="actual-deaths-section">
            <div class="section-title">
                <span class="icon">💀</span>
                <span>Cementerio</span>
                <span class="count">${deaths.length}</span>
            </div>
            <div class="actual-deaths-grid">${deathsHTML}</div>
        </section>
        ` : ''}
    `;
}

// ===================== RENDER PARTY =====================

function renderDetailParty(party) {
    const grid = document.getElementById('detail-party-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (party.length === 0) {
        grid.innerHTML = '<div class="no-data-msg" style="grid-column:1/-1"><span class="icon">🎒</span><p>Sin Pokémon en el equipo</p></div>';
        return;
    }

    party.forEach(poke => {
        const card = document.createElement('div');
        const classes = ['pokemon-card'];
        if (poke.isShiny) classes.push('shiny');
        if (poke.isDead) classes.push('dead');
        card.className = classes.join(' ');

        const hpPercent = poke.stats && poke.stats.maxHP > 0
            ? Math.round((poke.stats.hp / poke.stats.maxHP) * 100)
            : 100;
        const hpClass = hpPercent > 50 ? 'hp-high' : hpPercent > 20 ? 'hp-mid' : 'hp-low';

        card.innerHTML = `
            <div class="card-header">
                <div class="sprite-container">
                    ${createSpriteImg(poke.speciesId, poke.isShiny, 68).outerHTML}
                </div>
                <div class="card-info">
                    <div class="name-row">
                        <span class="pokemon-name">${escapeHtml(poke.nickname)}</span>
                        ${poke.gender !== '—' ? `<span class="gender ${poke.gender === '♂' ? 'male' : 'female'}">${poke.gender}</span>` : ''}
                    </div>
                    ${poke.nickname !== poke.species ? `<div class="species-name">${escapeHtml(poke.species)}</div>` : ''}
                    <div class="level-badge">Lv. ${poke.level}</div>
                </div>
            </div>

            ${poke.stats ? `
            <div class="hp-bar-container">
                <div class="hp-label">
                    <span>HP</span>
                    <span>${poke.stats.hp} / ${poke.stats.maxHP}</span>
                </div>
                <div class="hp-bar">
                    <div class="hp-bar-fill ${hpClass}" style="width: ${hpPercent}%"></div>
                </div>
            </div>
            ` : ''}

            <div class="card-meta">
                <div class="meta-item"><span class="label">Naturaleza:</span> ${poke.nature}</div>
                <div class="meta-item"><span class="label">Habilidad:</span> ${escapeHtml(poke.ability)}</div>
                ${poke.heldItem !== '—' ? `<div class="meta-item"><span class="label">Objeto:</span> ${escapeHtml(poke.heldItem)}</div>` : ''}
            </div>

            <div class="moves-grid">
                ${(poke.moves || []).map(m => `<div class="move-tag">${escapeHtml(m.name)}</div>`).join('')}
            </div>

            <div class="stats-row">
                ${renderStatCell('HP', poke.stats ? poke.stats.maxHP : '?', poke.ivs.hp, poke.evs.hp)}
                ${renderStatCell('ATK', poke.stats ? poke.stats.atk : '?', poke.ivs.atk, poke.evs.atk)}
                ${renderStatCell('DEF', poke.stats ? poke.stats.def : '?', poke.ivs.def, poke.evs.def)}
                ${renderStatCell('SPA', poke.stats ? poke.stats.spa : '?', poke.ivs.spa, poke.evs.spa)}
                ${renderStatCell('SPD', poke.stats ? poke.stats.spd : '?', poke.ivs.spd, poke.evs.spd)}
                ${renderStatCell('SPE', poke.stats ? poke.stats.spe : '?', poke.ivs.spe, poke.evs.spe)}
            </div>
        `;

        grid.appendChild(card);
    });
}

function renderStatCell(label, value, iv, ev) {
    return `
        <div class="stat-item">
            <div class="stat-label">${label}</div>
            <div class="stat-val">${value}</div>
            <div class="iv-val ${iv === 31 ? 'perfect' : ''}">${iv} IV${ev > 0 ? ` / ${ev} EV` : ''}</div>
        </div>
    `;
}

// ===================== RENDER BOX =====================

function renderDetailBoxTabs(boxes) {
    const tabs = document.getElementById('detail-box-tabs');
    if (!tabs || !boxes) return;
    tabs.innerHTML = '';

    let totalPokemon = 0;
    boxes.forEach((box, i) => {
        const slots = box.slots || [];
        const filled = slots.filter(Boolean).length;
        totalPokemon += filled;

        const tab = document.createElement('button');
        tab.className = `box-tab${i === 0 ? ' active' : ''}`;
        tab.innerHTML = `Box ${i + 1}<span class="tab-count">${filled > 0 ? filled : ''}</span>`;
        tab.addEventListener('click', () => {
            document.querySelectorAll('#detail-box-tabs .box-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentBox = i;
            renderDetailBox(i, boxes);
        });
        tabs.appendChild(tab);
    });

    const totalEl = document.getElementById('detail-box-total');
    if (totalEl) totalEl.textContent = `${totalPokemon} Pokémon`;
}

function renderDetailBox(boxIndex, boxes) {
    const grid = document.getElementById('detail-box-grid');
    if (!grid || !boxes || !boxes[boxIndex]) return;

    const box = boxes[boxIndex];
    const slots = box.slots || [];
    grid.innerHTML = '';

    slots.forEach(poke => {
        const slot = document.createElement('div');
        if (poke) {
            const slotClasses = ['box-slot', 'occupied'];
            if (poke.isShiny) slotClasses.push('shiny');
            if (poke.isDead) slotClasses.push('dead');
            slot.className = slotClasses.join(' ');
            slot.innerHTML = `
                ${poke.isDead ? '<div class="death-marker">💀</div>' : ''}
                ${createSpriteImg(poke.speciesId, poke.isShiny, 56).outerHTML.replace('>', ' class="slot-sprite">')}
                <div class="slot-name">${escapeHtml(poke.nickname)}</div>
                ${poke.nickname !== poke.species ? `<div class="slot-species">${escapeHtml(poke.species)}</div>` : ''}
            `;
            slot.addEventListener('click', () => showModal(poke));
        } else {
            slot.className = 'box-slot empty';
            slot.innerHTML = `<div class="slot-sprite" style="width:56px;height:56px;opacity:0.1;display:flex;align-items:center;justify-content:center;font-size:1.5rem;">●</div>`;
        }
        grid.appendChild(slot);
    });
}

// ===================== GRAVEYARD =====================

function renderDetailGraveyard(nuzlocke) {
    const section = document.getElementById('detail-graveyard');
    const grid = document.getElementById('detail-graveyard-grid');
    if (!section || !grid) return;

    const deaths = nuzlocke.deaths || [];
    if (deaths.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    document.getElementById('detail-graveyard-count').textContent = deaths.length;
    grid.innerHTML = '';

    deaths.forEach(death => {
        const card = document.createElement('div');
        card.className = 'graveyard-card';
        const date = new Date(death.diedAt);
        const timeStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

        card.innerHTML = `
            <div class="grave-sprite">
                ${createSpriteImg(death.speciesId, death.isShiny, 56).outerHTML}
            </div>
            <div class="grave-info">
                <div class="grave-name">${escapeHtml(death.nickname || death.species)}</div>
                ${death.nickname && death.nickname !== death.species ? `<div class="grave-species">${escapeHtml(death.species)}</div>` : ''}
                <div class="grave-level">Lv. ${death.level}</div>
                <div class="grave-date">🕊️ ${timeStr}</div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// ===================== MODAL =====================

function showModal(poke) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
        <div style="position:relative">
            <button class="modal-close" onclick="closeModal()">✕</button>
            <div class="card-header">
                <div class="sprite-container">
                    ${createSpriteImg(poke.speciesId, poke.isShiny, 88).outerHTML}
                </div>
                <div class="card-info">
                    <div class="name-row">
                        <span class="pokemon-name">${escapeHtml(poke.nickname)}</span>
                        ${poke.gender !== '—' ? `<span class="gender ${poke.gender === '♂' ? 'male' : 'female'}">${poke.gender}</span>` : ''}
                        ${poke.isShiny ? '<span style="margin-left:4px">✨</span>' : ''}
                    </div>
                    ${poke.nickname !== poke.species ? `<div class="species-name">#${poke.speciesId} ${escapeHtml(poke.species)}</div>` : `<div class="species-name">#${poke.speciesId}</div>`}
                    ${poke.level > 0 ? `<div class="level-badge">Lv. ${poke.level}</div>` : ''}
                </div>
            </div>

            <div class="card-meta" style="margin: 16px 0">
                <div class="meta-item"><span class="label">Naturaleza:</span> ${poke.nature}</div>
                <div class="meta-item"><span class="label">Habilidad:</span> ${escapeHtml(poke.ability)}</div>
                ${poke.heldItem !== '—' ? `<div class="meta-item"><span class="label">Objeto:</span> ${escapeHtml(poke.heldItem)}</div>` : ''}
                ${poke.otName ? `<div class="meta-item"><span class="label">OT:</span> ${escapeHtml(poke.otName)}</div>` : ''}
            </div>

            <div style="margin-bottom:16px">
                <div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Movimientos</div>
                <div class="moves-grid">
                    ${(poke.moves || []).map(m => `<div class="move-tag">${escapeHtml(m.name)} <span style="opacity:0.5;font-size:0.65rem">${m.pp}PP</span></div>`).join('')}
                </div>
            </div>

            <div style="margin-bottom:16px">
                <div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">IVs</div>
                <div class="stats-row">
                    ${['hp','atk','def','spa','spd','spe'].map(stat =>
                        `<div class="stat-item">
                            <div class="stat-label">${stat.toUpperCase()}</div>
                            <div class="stat-val ${poke.ivs[stat] === 31 ? 'perfect' : ''}" style="${poke.ivs[stat] === 31 ? 'color:var(--accent-gold)' : ''}">${poke.ivs[stat]}</div>
                        </div>`
                    ).join('')}
                </div>
            </div>

            <div>
                <div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">EVs</div>
                <div class="stats-row">
                    ${['hp','atk','def','spa','spd','spe'].map(stat =>
                        `<div class="stat-item">
                            <div class="stat-label">${stat.toUpperCase()}</div>
                            <div class="stat-val">${poke.evs[stat]}</div>
                        </div>`
                    ).join('')}
                </div>
            </div>
        </div>
    `;

    overlay.classList.add('visible');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('visible');
}

// ===================== HELPERS =====================

function getSpriteUrl(speciesId, isShiny) {
    return `${isShiny ? SPRITE_SHINY_BASE : SPRITE_BASE}${speciesId}.png`;
}

function createSpriteImg(speciesId, isShiny, size = 68) {
    const img = document.createElement('img');
    img.src = getSpriteUrl(speciesId, isShiny);
    img.alt = '';
    img.width = size;
    img.height = size;
    img.style.imageRendering = 'pixelated';
    img.onerror = () => { img.src = `${SPRITE_BASE}0.png`; };
    return img;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===================== KALOS LOCATION NAMES (PKHeX XY es) =====================

// Location ID → Spanish name from PKHeX text_xy_00000_es.txt
// IDs = 0-based line index in the file (confirmed with save data)
const KALOS_LOCATIONS = {
    0: '—', 2: 'Lugar misterioso', 4: 'Lugar lejano',
    6: 'Pueblo Boceto', 8: 'Ruta 1', 9: 'Sendero Boceto',
    10: 'Pueblo Acuarela',
    12: 'Ruta 2', 13: 'Vía del Avance', 14: 'Bosque de Novarte',
    16: 'Ruta 3', 17: 'Senda Despejada', 18: 'Ciudad Novarte',
    20: 'Ruta 4', 21: 'Senda del Parterre', 22: 'Ciudad Luminalia',
    24: 'Torre Prisma', 26: 'Laboratorios Lysson',
    28: 'Ruta 5', 29: 'Vía Repecho', 30: 'Pueblo Vánitas',
    32: 'Castillo Caduco', 34: 'Ruta 6', 35: 'Alameda del Palacio',
    36: 'Palacio Cénit', 38: 'Ruta 7', 39: 'Paseo de la Ribera',
    40: 'Ciudad Relieve', 42: 'Ruta 8', 43: 'Muralla Costera',
    44: 'Pueblo Petroglifo', 46: 'Ruta 9', 47: 'Paso de Rhyhorn',
    48: 'Bastión Batalla', 50: 'Ruta 10', 51: 'Camino Menhires',
    52: 'Pueblo Crómlech', 54: 'Ruta 11', 55: 'Senda Reflejos',
    56: 'Cueva Reflejos', 58: 'Ciudad Yantra', 60: 'Torre Maestra',
    62: 'Ruta 12', 63: 'Vereda del Heno', 64: 'Ciudad Témpera',
    66: 'Ruta 13', 67: 'Páramo de Luminalia',
    68: 'Ruta 14', 69: 'Arboleda Romantis', 70: 'Ciudad Romantis',
    72: 'Fábrica Poké Balls', 74: 'Ruta 15', 75: 'Sendero Hojarasca',
    76: 'Pueblo Fresco', 78: 'Ruta 16', 79: 'Senda Melancolía',
    82: 'Gruta Helada', 84: 'Ruta 17', 85: 'Sendero Mamoswine',
    86: 'Ciudad Fluxus', 88: 'Ruta 18', 89: 'Senda Valle Angosto',
    90: 'Pueblo Mosaico', 92: 'Ruta 19', 93: 'Senda del Gran Valle',
    94: 'Ciudad Fractal', 96: 'Ruta 20', 97: 'Bosque Errantes',
    98: 'Villa Pokémon', 100: 'Ruta 21', 101: 'Vía Ultimia',
    102: 'Ruta 22', 103: 'Vía Desvío', 104: 'Calle Victoria',
    106: 'Liga Pokémon', 108: 'Ciudad Batik', 110: 'Mansión Batalla',
    112: 'Bahía Azul', 114: 'Acceso a Fresco', 116: 'Acceso a Mosaico',
    118: 'Acceso a Petroglifo', 120: 'Acceso a Luminalia',
    122: 'Acceso a Yantra', 124: 'Acceso a Témpera',
    126: 'Acceso a Romantis', 128: 'Acceso a Fluxus',
    130: 'Acceso a Fractal', 132: 'Cueva Brillante',
    134: 'Gruta Tierraunida', 135: 'Escondrijo Zubat',
    136: 'Central de Kalos', 138: 'Guarida Team Flare',
    140: 'Cueva Desenlace', 142: 'Hotel Desolación',
    144: 'Estancia Vacua', 146: 'Cueva Talasia',
    148: 'Safari Amistad', 150: 'Sala de las Llamas',
    152: 'Sala de la Esclusa', 154: 'Sala del Metal',
    156: 'Sala del Draco', 158: 'Sala de la Luz',
    160: 'Acceso Liga Pokémon', 162: 'Estación Luminalia',
    164: 'Estación Batik', 166: 'Acuario Petroglifo',
    168: 'Mazmorra Rara',
};

// Special display names and emojis for certain locations
const LOCATION_DISPLAY = {
    10: { name: '🎁 Starters', sub: 'Pueblo Acuarela' },
    14: { name: '🌲 Bosque de Novarte', sub: 'Santalune Forest' },
    22: { name: '🏙️ Ciudad Luminalia', sub: 'Agua / Intercambio' },
    24: { name: '🗼 Torre Prisma', sub: 'Ciudad Luminalia' },
    56: { name: '🪞 Cueva Reflejos', sub: 'Reflection Cave' },
    82: { name: '❄️ Gruta Helada', sub: 'Frost Cavern' },
    106: { name: '🏆 Liga Pokémon', sub: 'Pokémon League' },
    112: { name: '🌊 Bahía Azul', sub: 'Azure Bay' },
    132: { name: '💎 Cueva Brillante', sub: 'Glittering Cave' },
    136: { name: '⚡ Central de Kalos', sub: 'Power Plant' },
    138: { name: '🔥 Guarida Team Flare', sub: 'Team Flare HQ' },
    140: { name: '🏔️ Cueva Desenlace', sub: 'Terminus Cave' },
    148: { name: '🦋 Safari Amistad', sub: 'Friend Safari' },
};

// ===================== ROUTES TAB =====================

function renderRoutes() {
    const container = document.getElementById('routes-container');
    const countEl = document.getElementById('routes-count');
    if (!container) return;

    // Collect ALL pokemon from ALL users
    const routeMap = {}; // locationId → [{ pokemon, username, initial }]

    allUsers.forEach(user => {
        const username = user.username || 'Unknown';
        const initial = username.charAt(0).toUpperCase();
        const party = user.party || [];
        const boxes = user.boxes || [];

        const addPoke = (poke) => {
            if (!poke || poke.isEgg) return;
            const locId = poke.metLocation || 0;
            if (!routeMap[locId]) routeMap[locId] = [];
            routeMap[locId].push({ pokemon: poke, username, initial });
        };

        party.forEach(addPoke);
        boxes.forEach(box => (box.slots || []).forEach(addPoke));
    });

    // Sort location IDs in game order
    const locationIds = Object.keys(routeMap).map(Number).sort((a, b) => a - b);

    // Filter out location 0 (unknown)
    const validIds = locationIds.filter(id => id > 0);
    if (countEl) countEl.textContent = validIds.length;

    if (validIds.length === 0) {
        container.innerHTML = `
            <div class="no-data-msg"><span class="icon">🗺️</span><p>Sin datos de rutas aún</p></div>
        `;
        return;
    }

    container.innerHTML = '';

    validIds.forEach(locId => {
        const pokemonList = routeMap[locId];
        const display = LOCATION_DISPLAY[locId];
        const locName = display ? display.name : (KALOS_LOCATIONS[locId] || `Ubicación #${locId}`);
        const locSub = display ? display.sub : '';

        const routeBox = document.createElement('div');
        routeBox.className = 'route-box';

        const headerHTML = `
            <div class="route-header">
                <div class="route-title">${locName}</div>
                ${locSub ? `<div class="route-sub">${locSub}</div>` : ''}
                <span class="route-count">${pokemonList.length}</span>
            </div>
        `;

        let slotsHTML = '<div class="route-grid">';
        pokemonList.forEach(entry => {
            const p = entry.pokemon;
            const spriteUrl = getSpriteUrl(p.speciesId, p.isShiny);
            slotsHTML += `
                <div class="route-pokemon${p.isShiny ? ' shiny' : ''}" title="${escapeHtml(p.nickname || p.species)} Lv.${p.level} — ${escapeHtml(entry.username)}">
                    <div class="route-trainer-badge">${entry.initial}</div>
                    <img src="${spriteUrl}" alt="${escapeHtml(p.species)}" width="56" height="56" style="image-rendering:pixelated" onerror="this.src='${SPRITE_BASE}0.png'" />
                    <div class="route-poke-name">${escapeHtml(p.nickname || p.species)}</div>
                    <div class="route-poke-level">Lv.${p.level || '?'}</div>
                </div>
            `;
        });
        slotsHTML += '</div>';

        routeBox.innerHTML = headerHTML + slotsHTML;
        container.appendChild(routeBox);
    });
}

// ===================== LEAGUE TABS =====================

function switchLeagueTab(tabName) {
    document.querySelectorAll('.league-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.league-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
}

// ===================== RANKINGS =====================

function getTrainerStats(user) {
    const party = user.party || [];
    const boxes = user.boxes || [];
    const nuzlocke = user.nuzlocke || { deaths: [] };
    const deaths = nuzlocke.deaths ? nuzlocke.deaths.length : 0;
    const trainer = user.trainer || {};
    const badges = trainer.badgeCount || 0;

    // Count unique species
    const speciesSet = new Set();
    party.forEach(p => { if (p && p.speciesId) speciesSet.add(p.speciesId); });
    boxes.forEach(b => (b.slots || []).forEach(p => { if (p && p.speciesId) speciesSet.add(p.speciesId); }));
    const uniqueSpecies = speciesSet.size;

    // Count shinys
    let shinys = 0;
    const shinyList = [];
    party.forEach(p => { if (p && p.isShiny) { shinys++; shinyList.push(p); } });
    boxes.forEach(b => (b.slots || []).forEach(p => { if (p && p.isShiny) { shinys++; shinyList.push(p); } }));

    // Points: badges * 100 + unique species milestone bonuses - deaths * 50
    let points = badges * 100;
    [10, 25, 50, 100].forEach(t => { if (uniqueSpecies >= t) points += 100; });
    points -= deaths * 50;

    return { deaths, badges, uniqueSpecies, shinys, shinyList, points, deathList: nuzlocke.deaths || [] };
}

function renderRankings() {
    if (!allUsers || allUsers.length === 0) return;

    const stats = allUsers.map(user => ({
        user,
        ...getTrainerStats(user),
    }));

    // --- MÁS PUNTOS ---
    const byPoints = [...stats].sort((a, b) => b.points - a.points);
    const pointsEl = document.getElementById('ranking-points');
    pointsEl.innerHTML = '';
    byPoints.forEach((s, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
        pointsEl.innerHTML += `
            <div class="ranking-row ${i === 0 ? 'gold' : ''}">
                <span class="rank-pos">${medal}</span>
                <span class="rank-name">${escapeHtml(s.user.username)}</span>
                <span class="rank-detail">
                    <span class="rank-value">${s.points} pts</span>
                    <span class="rank-sub">🏅${s.badges} | 📖${s.uniqueSpecies} | 💀${s.deaths}</span>
                </span>
            </div>
        `;
    });

    // --- MÁS MUERTOS ---
    const byDeaths = [...stats].sort((a, b) => b.deaths - a.deaths);
    const deathsEl = document.getElementById('ranking-deaths');
    deathsEl.innerHTML = '';
    byDeaths.forEach((s, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
        const deathSprites = s.deathList.map(d =>
            `<img src="${getSpriteUrl(d.speciesId, d.isShiny)}" alt="${escapeHtml(d.species)}" title="${escapeHtml(d.nickname || d.species)} Lv.${d.level}" width="36" height="36" onerror="this.src='${SPRITE_BASE}0.png'">`
        ).join('');
        deathsEl.innerHTML += `
            <div class="ranking-row ${i === 0 ? 'gold' : ''}">
                <span class="rank-pos">${medal}</span>
                <span class="rank-name">${escapeHtml(s.user.username)}</span>
                <span class="rank-value">${s.deaths} 💀</span>
            </div>
            ${deathSprites ? `<div class="ranking-sprites">${deathSprites}</div>` : ''}
        `;
    });

    // --- MÁS SHINYS ---
    const byShinys = [...stats].sort((a, b) => b.shinys - a.shinys);
    const shinysEl = document.getElementById('ranking-shinys');
    shinysEl.innerHTML = '';
    byShinys.forEach((s, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
        const shinySprites = s.shinyList.map(p =>
            `<img src="${getSpriteUrl(p.speciesId, true)}" alt="${escapeHtml(p.species)}" title="✨ ${escapeHtml(p.nickname || p.species)} Lv.${p.level}" width="36" height="36" onerror="this.src='${SPRITE_BASE}0.png'">`
        ).join('');
        shinysEl.innerHTML += `
            <div class="ranking-row ${i === 0 ? 'gold' : ''}">
                <span class="rank-pos">${medal}</span>
                <span class="rank-name">${escapeHtml(s.user.username)}</span>
                <span class="rank-value">${s.shinys} ✨</span>
            </div>
            ${shinySprites ? `<div class="ranking-sprites">${shinySprites}</div>` : ''}
        `;
    });
}
