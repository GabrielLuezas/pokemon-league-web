// ===================== POKEMON LEAGUE — WEB DASHBOARD =====================

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
const SPRITE_SHINY_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/';

let allUsers = [];
let currentTrainer = null;
let currentBox = 0;

// ===================== AVATAR HELPER =====================

/**
 * Returns HTML for a round avatar circle — shows <img> if avatarUrl is set,
 * else shows the initial letter. className is the CSS class of the container.
 */
function renderAvatarCircle(className, initial, avatarUrl, imgClass = 'avatar-circle-img') {
    if (avatarUrl) {
        return `<div class="${className}"><img src="${avatarUrl}" class="${imgClass}" alt="Avatar" onerror="this.parentNode.textContent='${escapeHtml(initial)}'"></div>`;
    }
    return `<div class="${className}">${escapeHtml(initial)}</div>`;
}

// ===================== INIT =====================

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById('auth-modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeAuthModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeModal(); closeAuthModal(); }
    });

    // Auth form handlers
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);

    // Restore auth state
    restoreAuth();

    await loadTrainers();
    renderGymLeaders();
    renderPokemonList();
    loadTournament();

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

        // Sync logged-in user's avatar from DB (in case it was changed elsewhere)
        if (authUser) {
            const me = allUsers.find(u => u.id === authUser.id);
            if (me && me.avatar_url !== authUser.avatar_url) {
                authUser.avatar_url = me.avatar_url;
                localStorage.setItem('avatarUrl', me.avatar_url || '');
                updateAuthUI();
            }
        }

        renderTrainers();
        renderRankings();
        renderRoutes();
        renderGymLeaders();
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

            // Sync logged-in user's avatar from DB if this is the current user
            if (authUser && data.id === authUser.id && data.avatar_url !== authUser.avatar_url) {
                authUser.avatar_url = data.avatar_url;
                localStorage.setItem('avatarUrl', data.avatar_url || '');
                updateAuthUI();
            }
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
                ${renderAvatarCircle('trainer-avatar', initial, user.avatar_url)}
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
    // Render immediately with whatever data we have (no boxes yet from /api/users)
    renderTrainerDetail(user);
    // Then fetch full data with boxes and update only the box section
    fetchTrainerWithBoxes(user.id);
}

async function fetchTrainerWithBoxes(userId) {
    // Show loading spinner in box section
    const boxGrid = document.getElementById('detail-box-grid');
    const boxTabs = document.getElementById('detail-box-tabs');
    if (boxTabs) boxTabs.innerHTML = '';
    if (boxGrid) {
        boxGrid.innerHTML = `
            <div class="box-loading">
                <div class="box-loading-pokeball">
                    <div class="pokeball-top"></div>
                    <div class="pokeball-middle"></div>
                    <div class="pokeball-bottom"></div>
                    <div class="pokeball-center"></div>
                </div>
                <div class="box-loading-text">Cargando cajas del PC...</div>
            </div>
        `;
    }
    try {
        const res = await fetch(`/api/users/${userId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const fullData = await res.json();
        currentTrainer = fullData;
        // Only update the box section (don't re-render the whole detail)
        const boxes = fullData.boxes || [];
        renderDetailBoxTabs(boxes);
        renderDetailBox(0, boxes);
        const totalEl = document.getElementById('detail-box-total');
        const totalPokemon = boxes.reduce((s, b) => s + (b.slots || []).filter(Boolean).length, 0);
        if (totalEl) totalEl.textContent = `${totalPokemon} Pokémon`;
    } catch (err) {
        if (boxGrid) {
            boxGrid.innerHTML = `<div class="no-data-msg" style="grid-column:1/-1"><span class="icon">⚠️</span><p>Error cargando cajas</p></div>`;
        }
        console.error('Error fetching boxes:', err);
    }
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
            ${renderAvatarCircle('detail-avatar', initial, user.avatar_url)}
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

/**
 * Auto-detect whether DB values are raw counts (new app v1.7.1+) or pre-multiplied (old app).
 * Raw counts: earned ≤ 100 (max ~60 challenges), deaths ≤ reasonable count.
 * Pre-multiplied: earned is already multiplied by 100 (e.g. 5700).
 * Returns { displayEarned, displayDeaths, displaySpent, displayPoints }.
 */
function getNuzlockePointsDisplay(user, fallbackDeaths) {
    const earned = user.nuzlocke_points_earned ?? 0;
    const deaths = user.nuzlocke_points_deaths ?? fallbackDeaths ?? 0;
    const spent  = user.nuzlocke_points_spent  ?? 0;

    // Heuristic: if earned ≤ 100, it's a raw challenge count (new format).
    // No player can complete more than ~60 challenges.
    // If earned > 100, it's pre-multiplied (old format, e.g. 5700).
    const isRawFormat = earned <= 100;

    const displayEarned = isRawFormat ? earned * 100 : earned;
    const displayDeaths = isRawFormat ? deaths * 50  : deaths;
    const displaySpent  = spent;
    // Always compute from raw values to ensure accuracy
    const displayPoints = displayEarned - displayDeaths - displaySpent;

    return { displayEarned, displayDeaths, displaySpent, displayPoints };
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

    // Points: auto-detect raw counts vs pre-multiplied, use nuzlocke_points as total
    const stats = getTrainerStats(user);
    const { displayEarned, displayDeaths, displaySpent, displayPoints } = getNuzlockePointsDisplay(user, stats.deaths);

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
            ${renderAvatarCircle('actual-trainer-avatar', initial, user.avatar_url)}
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
            <div class="detail-points-total">${displayPoints}</div>
            <div class="detail-points-badges">
                <span class="points-badge earned">+${displayEarned}</span>
                ${displayDeaths > 0 ? `<span class="points-badge penalty">-${displayDeaths} muertes</span>` : ''}
                ${displaySpent  > 0 ? `<span class="points-badge spent">-${displaySpent} gastados</span>` : ''}
            </div>
            <div class="detail-points-breakdown">
                ${displayDeaths > 0 ? `<div class="detail-points-item penalty">💀 Penalidad muertes: -${displayDeaths}</div>` : ''}
                ${displaySpent > 0 ? `<div class="detail-points-item spent">🛒 Gastados en tienda: -${displaySpent}</div>` : ''}
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
    36: 'Gacha', 38: 'Ruta 7', 39: 'Paseo de la Ribera',
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
    36: { name: '🎰 Gacha', sub: 'Pokémon obtenido por gacha' },
    132: { name: '💎 Cueva Brillante', sub: 'Glittering Cave' },
    136: { name: '⚡ Central de Kalos', sub: 'Power Plant' },
    138: { name: '🔥 Guarida Team Flare', sub: 'Team Flare HQ' },
    140: { name: '🏔️ Cueva Desenlace', sub: 'Terminus Cave' },
    148: { name: '🦋 Safari Amistad', sub: 'Friend Safari' },
};

// ===================== ROUTES TAB =====================

// Persisted state for routes tab
let _routeMap = {};         // locationId → [{ pokemon, username, initial, avatarUrl }]
let _routeValidIds = [];    // sorted, valid location IDs
let _openRoutes = new Set(); // which route locIds are expanded
let _routeFilter = 'all';    // username filter, 'all' = show everyone

function renderRoutes() {
    const container = document.getElementById('routes-container');
    const countEl = document.getElementById('routes-count');
    if (!container) return;

    // Collect ALL pokemon from ALL users
    _routeMap = {};
    const trainerNames = new Set();

    allUsers.forEach(user => {
        const username = user.username || 'Unknown';
        const initial = username.charAt(0).toUpperCase();
        const party = user.party || [];
        const boxes = user.boxes || [];
        trainerNames.add(username);

        const addPoke = (poke) => {
            if (!poke || poke.isEgg) return;
            const locId = poke.metLocation || 0;
            if (!_routeMap[locId]) _routeMap[locId] = [];
            _routeMap[locId].push({ pokemon: poke, username, initial, avatarUrl: user.avatar_url || null });
        };

        party.forEach(addPoke);
        boxes.forEach(box => (box.slots || []).forEach(addPoke));
    });

    // Sort location IDs in game order, filter out 0
    const locationIds = Object.keys(_routeMap).map(Number).sort((a, b) => a - b);
    _routeValidIds = locationIds.filter(id => id > 0);

    if (countEl) countEl.textContent = _routeValidIds.length;

    if (_routeValidIds.length === 0) {
        container.innerHTML = `
            <div class="no-data-msg"><span class="icon">🗺️</span><p>Sin datos de rutas aún</p></div>
        `;
        return;
    }

    // Build trainer filter bar
    let filterHTML = `<div class="routes-filter-bar">
        <span class="routes-filter-label">🔍 Entrenador:</span>
        <div class="routes-filter-pills">
            <button class="route-filter-pill active" data-trainer="all" onclick="applyRouteFilter('all')">Todos</button>`;
    [...trainerNames].sort().forEach(name => {
        filterHTML += `<button class="route-filter-pill" data-trainer="${escapeHtml(name)}" onclick="applyRouteFilter('${escapeHtml(name)}')">${escapeHtml(name)}</button>`;
    });
    filterHTML += `</div></div>`;

    container.innerHTML = filterHTML;
    _routeFilter = 'all';

    // Render route boxes
    _routeValidIds.forEach(locId => {
        container.appendChild(_buildRouteBox(locId));
    });
}

function _buildRouteBox(locId) {
    const allEntries = _routeMap[locId] || [];
    const entries = _routeFilter === 'all'
        ? allEntries
        : allEntries.filter(e => e.username === _routeFilter);

    const display = LOCATION_DISPLAY[locId];
    const locName = display ? display.name : (KALOS_LOCATIONS[locId] || `Ubicación #${locId}`);
    const locSub = display ? display.sub : '';
    const isOpen = _openRoutes.has(locId);
    const isHidden = entries.length === 0;

    const routeBox = document.createElement('div');
    routeBox.className = 'route-box' + (isHidden ? ' route-box-hidden' : '');
    routeBox.id = `route-box-${locId}`;

    // Header (always visible, acts as toggle)
    const headerHTML = `
        <div class="route-header route-header-toggle" onclick="toggleRoute(${locId})">
            <div class="route-chevron${isOpen ? ' open' : ''}">▶</div>
            <div class="route-title">${locName}</div>
            ${locSub ? `<div class="route-sub">${locSub}</div>` : ''}
            <span class="route-count">${entries.length}</span>
        </div>
    `;

    // Grid (collapsed by default)
    let slotsHTML = `<div class="route-grid-wrap${isOpen ? ' open' : ''}">`;
    slotsHTML += '<div class="route-grid">';
    entries.forEach(entry => {
        const p = entry.pokemon;
        const spriteUrl = getSpriteUrl(p.speciesId, p.isShiny);
        const badgeContent = entry.avatarUrl
            ? `<img src="${entry.avatarUrl}" class="avatar-circle-img" alt="" onerror="this.parentNode.textContent='${escapeHtml(entry.initial)}'">` 
            : entry.initial;
        slotsHTML += `
            <div class="route-pokemon${p.isShiny ? ' shiny' : ''}" title="${escapeHtml(p.nickname || p.species)} Lv.${p.level} — ${escapeHtml(entry.username)}">
                <div class="route-trainer-badge">${badgeContent}</div>
                <img src="${spriteUrl}" alt="${escapeHtml(p.species)}" width="56" height="56" style="image-rendering:pixelated" onerror="this.src='${SPRITE_BASE}0.png'" loading="lazy" />
                <div class="route-poke-name">${escapeHtml(p.nickname || p.species)}</div>
                <div class="route-poke-level">Lv.${p.level || '?'}</div>
            </div>
        `;
    });
    slotsHTML += '</div></div>';

    routeBox.innerHTML = headerHTML + slotsHTML;
    return routeBox;
}

function toggleRoute(locId) {
    if (_openRoutes.has(locId)) {
        _openRoutes.delete(locId);
    } else {
        _openRoutes.add(locId);
    }
    // Re-render just this box
    const existing = document.getElementById(`route-box-${locId}`);
    if (existing) {
        const newBox = _buildRouteBox(locId);
        existing.replaceWith(newBox);
    }
}

function applyRouteFilter(trainer) {
    _routeFilter = trainer;

    // Update pill active states
    document.querySelectorAll('.route-filter-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.trainer === trainer);
    });

    // Re-render all route boxes
    _routeValidIds.forEach(locId => {
        const existing = document.getElementById(`route-box-${locId}`);
        if (existing) {
            const newBox = _buildRouteBox(locId);
            existing.replaceWith(newBox);
        }
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

    // Points: use pre-computed value from server if available, fallback to badges*100 - deaths*50
    let points = badges * 100;
    points -= deaths * 50;
    return { deaths, badges, uniqueSpecies, shinys, shinyList, points, deathList: nuzlocke.deaths || [] };
}

// ===================== RANKING SUB-TABS =====================

let activeRankingTab = 'points';

function switchRankingTab(tab) {
    activeRankingTab = tab;
    document.querySelectorAll('.ranking-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.rtab === tab);
    });
    document.querySelectorAll('.ranking-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `rpanel-${tab}`);
    });
}

// ===================== RANKINGS =====================

function renderRankings() {
    if (!allUsers || allUsers.length === 0) return;

    const stats = allUsers.map(user => {
        const ts = getTrainerStats(user);
        const pts = getNuzlockePointsDisplay(user, ts.deaths);
        return {
            user,
            ...ts,
            // Use nuzlocke_points (always correct) with auto-detect fallback
            displayPoints: pts.displayPoints,
        };
    });

    // Get logged-in username from localStorage (set by auth)
    const loggedUsername = localStorage.getItem('username') || null;

    buildRankingCategory(
        'ranking-points',
        [...stats].sort((a, b) => b.displayPoints - a.displayPoints),
        s => s.displayPoints,
        v => `${v} pts`,
        loggedUsername,
        'puntos'
    );

    buildRankingCategory(
        'ranking-deaths',
        [...stats].sort((a, b) => b.deaths - a.deaths),
        s => s.deaths,
        v => `${v} 💀`,
        loggedUsername,
        'muertes'
    );

    buildRankingCategory(
        'ranking-shinys',
        [...stats].sort((a, b) => b.shinys - a.shinys),
        s => s.shinys,
        v => `${v} ✨`,
        loggedUsername,
        'shinys'
    );
}

/**
 * Build a full ranking panel: podium (top 3) + list (4–10) + user position footer.
 * @param {string} containerId  - The element id to render into
 * @param {Array}  sorted       - Stats array sorted by the category descending
 * @param {Function} getValue   - (statEntry) => numeric value
 * @param {Function} formatVal  - (value) => display string
 * @param {string|null} loggedUsername
 * @param {string} unitLabel    - 'puntos' | 'muertes' | 'shinys'
 */
function buildRankingCategory(containerId, sorted, getValue, formatVal, loggedUsername, unitLabel) {
    const el = document.getElementById(containerId);
    if (!el) return;

    // Assign ranks (shared on tie)
    const ranked = [];
    let rank = 1;
    sorted.forEach((s, i) => {
        if (i > 0 && getValue(s) !== getValue(sorted[i - 1])) {
            rank = i + 1;
        }
        ranked.push({ ...s, rank });
    });

    const top10 = ranked.slice(0, 10);
    const loggedEntry = loggedUsername
        ? ranked.find(r => r.user.username.toLowerCase() === loggedUsername.toLowerCase())
        : null;
    const loggedInTop10 = loggedEntry ? top10.some(r => r.user.id === loggedEntry.user.id) : false;

    // ---- PODIUM (top 3) ----
    // Build slots with metadata BEFORE filtering so pos/medal don't shift
    const podiumSlots = [
        { entry: top10[1], pos: 'silver', medal: '🥈', size: 64 },
        { entry: top10[0], pos: 'gold',   medal: '🥇', size: 80 },
        { entry: top10[2], pos: 'bronze', medal: '🥉', size: 64 },
    ].filter(s => s.entry);

    function avatarHTML(entry, size, cls) {
        const initial = entry.user.username.charAt(0).toUpperCase();
        const url = entry.user.avatar_url;
        if (url) {
            return `<div class="podium-avatar ${cls}" style="width:${size}px;height:${size}px"><img src="${url}" class="avatar-circle-img" alt="${escapeHtml(initial)}" onerror="this.parentNode.textContent='${escapeHtml(initial)}'"></div>`;
        }
        return `<div class="podium-avatar ${cls}" style="width:${size}px;height:${size}px">${escapeHtml(initial)}</div>`;
    }

    const isLogged = (entry) => loggedUsername && entry.user.username.toLowerCase() === loggedUsername.toLowerCase();

    let podiumHTML = '<div class="podium-container">';
    podiumSlots.forEach(({ entry, pos, medal, size }) => {
        const highlight = isLogged(entry) ? ' podium-logged' : '';
        podiumHTML += `
            <div class="podium-slot ${pos}${highlight}">
                ${avatarHTML(entry, size, `podium-avatar-${pos}`)}
                <div class="podium-medal">${medal}</div>
                <div class="podium-name">${escapeHtml(entry.user.username)}</div>
                <div class="podium-value">${formatVal(getValue(entry))}</div>
                <div class="podium-rank-bar ${pos}"></div>
            </div>
        `;
    });
    podiumHTML += '</div>';

    // ---- TOP 10 LIST (positions 4-10) ----
    const listEntries = top10.slice(3);
    let listHTML = '';
    if (listEntries.length > 0) {
        listHTML = '<div class="ranking-list-top10">';
        listEntries.forEach(entry => {
            const highlight = isLogged(entry) ? ' ranking-row-logged' : '';
            const initial = entry.user.username.charAt(0).toUpperCase();
            const url = entry.user.avatar_url;
            const avatarEl = url
                ? `<div class="rank-avatar"><img src="${url}" class="avatar-circle-img" alt="${escapeHtml(initial)}" onerror="this.parentNode.textContent='${escapeHtml(initial)}'"></div>`
                : `<div class="rank-avatar">${escapeHtml(initial)}</div>`;
            listHTML += `
                <div class="ranking-row${highlight}">
                    <span class="rank-pos">#${entry.rank}</span>
                    ${avatarEl}
                    <span class="rank-name">${escapeHtml(entry.user.username)}</span>
                    <span class="rank-value">${formatVal(getValue(entry))}</span>
                </div>
            `;
        });
        listHTML += '</div>';
    }

    // ---- USER POSITION FOOTER (if not in top 10) ----
    let footerHTML = '';
    if (loggedEntry && !loggedInTop10) {
        footerHTML = `
            <div class="ranking-user-footer">
                <span class="ranking-user-footer-icon">🎖️</span>
                <span>Tú estás <strong>top ${loggedEntry.rank}</strong> con <strong>${formatVal(getValue(loggedEntry))}</strong> ${unitLabel}</span>
            </div>
        `;
    }

    el.innerHTML = podiumHTML + listHTML + footerHTML;
}

// ===================== INFO TAB =====================

let activeInfoTab = 'gym-leaders';

function switchInfoTab(tab) {
    activeInfoTab = tab;
    document.querySelectorAll('.info-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.itab === tab);
    });
    document.querySelectorAll('.info-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `ipanel-${tab}`);
    });
}

// ===================== GYM LEADERS =====================

const GYM_LEADERS = [
    {
        num: 1,
        name: 'Violeta',
        gym: 'Ciudad Novarte',
        level: 14,
        badge: '/badges/Medalla1.png',
        badgeName: 'Medalla Escarabajo',
    },
    {
        num: 2,
        name: 'Lino',
        gym: 'Ciudad Relieve',
        level: 30,
        badge: '/badges/Medalla2.png',
        badgeName: 'Medalla Muro',
    },
    {
        num: 3,
        name: 'Corelia',
        gym: 'Ciudad Yantra',
        level: 38,
        badge: '/badges/Medalla3.png',
        badgeName: 'Medalla Combate',
    },
    {
        num: 4,
        name: 'Amaro',
        gym: 'Ciudad Témpera',
        level: 41,
        badge: '/badges/Medalla4.png',
        badgeName: 'Medalla Planta',
    },
    {
        num: 5,
        name: 'Lem',
        gym: 'Ciudad Luminalia',
        level: 44,
        badge: '/badges/Medalla5.png',
        badgeName: 'Medalla Voltaje',
    },
    {
        num: 6,
        name: 'Valeria',
        gym: 'Ciudad Romantis',
        level: 50,
        badge: '/badges/Medalla6.png',
        badgeName: 'Medalla Hada',
    },
    {
        num: 7,
        name: 'Tileo',
        gym: 'Ciudad Fluxus',
        level: 58,
        badge: '/badges/Medalla7.png',
        badgeName: 'Medalla Psíquico',
    },
    {
        num: 8,
        name: 'Édel',
        gym: 'Ciudad Fractal',
        level: 71,
        badge: '/badges/Medalla8.png',
        badgeName: 'Medalla Iceberg',
    },
];

const ELITE_FOUR = [
    {
        num: 'E4',
        name: 'Alto Mando',
        gym: 'Liga Pokémon',
        icon: '⚔️',
        level: 78,
        isElite: true,
    },
    {
        num: 'C',
        name: 'Dianta',
        gym: 'Campeona',
        icon: '🏆',
        level: 82,
        isChampion: true,
    },
];

function renderGymLeaders() {
    const container = document.getElementById('gym-leaders-content');
    if (!container) return;

    let html = '';

    // Gym leaders title
    html += `
        <div class="gym-leaders-header">
            <div class="section-title"><span class="icon">🏟️</span><span>Líderes de Gimnasio</span></div>
        </div>
        <div class="gym-leaders-grid">
    `;

    GYM_LEADERS.forEach(leader => {
        html += `
            <div class="gym-leader-card">
                <div class="gym-leader-num">#${leader.num}</div>
                <div class="gym-leader-badge-wrap">
                    <img src="${leader.badge}" alt="${leader.badgeName}" class="gym-leader-badge-img" onerror="this.style.opacity='0.3'" />
                </div>
                <div class="gym-leader-info">
                    <div class="gym-leader-name">${escapeHtml(leader.name)}</div>
                    <div class="gym-leader-gym">${escapeHtml(leader.gym)}</div>
                </div>
                <div class="gym-leader-level">
                    <span class="gym-level-label">Nivel</span>
                    <span class="gym-level-value">${leader.level}</span>
                </div>
            </div>
        `;
    });

    html += '</div>';

    // Elite Four & Champion
    html += `
        <div class="gym-leaders-header" style="margin-top:40px">
            <div class="section-title"><span class="icon">👑</span><span>Élite y Campeona</span></div>
        </div>
        <div class="gym-leaders-grid gym-elite-grid">
    `;

    ELITE_FOUR.forEach(entry => {
        const cardClass = entry.isChampion ? 'gym-leader-card gym-champion-card' : 'gym-leader-card gym-elite-card';
        html += `
            <div class="${cardClass}">
                <div class="gym-leader-num${entry.isChampion ? ' champion-num' : ' elite-num'}">${entry.isChampion ? '👑' : '⚔️'}</div>
                <div class="gym-leader-badge-wrap">
                    <div class="gym-leader-no-badge">${entry.icon}</div>
                </div>
                <div class="gym-leader-info">
                    <div class="gym-leader-name">${escapeHtml(entry.name)}</div>
                    <div class="gym-leader-gym">${escapeHtml(entry.gym)}</div>
                </div>
                <div class="gym-leader-level${entry.isChampion ? ' champion-level' : ' elite-level'}">
                    <span class="gym-level-label">Nivel</span>
                    <span class="gym-level-value">${entry.level}</span>
                </div>
            </div>
        `;
    });

    html += '</div>';

    container.innerHTML = html;
}

// ===================== POKEMON PERMITIDOS / PROHIBIDOS =====================

// ⚠️  EDITAR ESTAS LISTAS con los Pokémon reales cuando el organizador los facilite.
// Formato: { id: <numero_pokedex>, name: '<nombre_español>' }

const POKEMON_BANNED = [
    // --- TITANES (BST > 600) ---
    { id: 150, name: 'Mewtwo', bst: 680 },
    { id: 249, name: 'Lugia', bst: 680 },
    { id: 250, name: 'Ho-Oh', bst: 680 },
    { id: 382, name: 'Kyogre', bst: 670 },
    { id: 383, name: 'Groudon', bst: 670 },
    { id: 384, name: 'Rayquaza', bst: 680 },
    { id: 483, name: 'Dialga', bst: 680 },
    { id: 484, name: 'Palkia', bst: 680 },
    { id: 487, name: 'Giratina', bst: 680 },
    { id: 493, name: 'Arceus', bst: 720 },
    { id: 643, name: 'Reshiram', bst: 680 },
    { id: 644, name: 'Zekrom', bst: 680 },
    { id: 646, name: 'Kyurem', bst: 660 },
    { id: 646, form: 'Black', name: 'Kyurem Negro', bst: 700 },
    { id: 646, form: 'White', name: 'Kyurem Blanco', bst: 700 },
    { id: 716, name: 'Xerneas', bst: 680 },
    { id: 717, name: 'Yveltal', bst: 680 },

    // --- CASOS ESPECIALES BANEADOS ---
    { id: 289, name: 'Slaking', bst: 670, reason: 'BST de Legendario y sin Ausente' },
    { id: 486, name: 'Regigigas', bst: 670, reason: 'BST de Legendario y sin Inicio Lento' }
];
const POKEMON_ALLOWED_SPECIAL = [

    { id: 144, name: 'Articuno' }, { id: 145, name: 'Zapdos' }, { id: 146, name: 'Moltres' },
    { id: 151, name: 'Mew' }, { id: 243, name: 'Raikou' }, { id: 244, name: 'Entei' },
    { id: 245, name: 'Suicune' }, { id: 251, name: 'Celebi' }, { id: 377, name: 'Regirock' },
    { id: 378, name: 'Regice' }, { id: 379, name: 'Registeel' }, { id: 380, name: 'Latias' },
    { id: 381, name: 'Latios' }, { id: 385, name: 'Jirachi' }, { id: 386, name: 'Deoxys' },

    // Gen 4-6
    { id: 480, name: 'Uxie' }, { id: 481, name: 'Mesprit' }, { id: 482, name: 'Azelf' },
    { id: 485, name: 'Heatran' }, { id: 488, name: 'Cresselia' }, { id: 490, name: 'Manaphy' },
    { id: 491, name: 'Darkrai' }, { id: 492, name: 'Shaymin' }, { id: 494, name: 'Victini' },
    { id: 638, name: 'Cobalion' }, { id: 639, name: 'Terrakion' }, { id: 640, name: 'Virizion' },
    { id: 641, name: 'Tornadus' }, { id: 642, name: 'Thundurus' }, { id: 645, name: 'Landorus' },
    { id: 647, name: 'Keldeo' }, { id: 648, name: 'Meloetta' }, { id: 649, name: 'Genesect' },
    { id: 718, name: 'Zygarde' }, { id: 719, name: 'Diancie' }, { id: 720, name: 'Hoopa' },
    { id: 721, name: 'Volcanion' },
];

function renderPokemonList() {
    const container = document.getElementById('pokemon-list-content');
    if (!container) return;

    function buildSection(title, emoji, items, emptyMsg, cardClass) {
        let html = `<div class="poke-list-section">`;
        html += `<h3 class="poke-list-subtitle">${emoji} ${title}</h3>`;
        if (items.length === 0) {
            html += `<p class="poke-list-empty">${emptyMsg}</p>`;
        } else {
            html += `<div class="poke-list-grid">`;
            items.forEach(p => {
                const spriteUrl = `${SPRITE_BASE}${p.id}.png`;
                html += `
                    <div class="poke-list-card ${cardClass}">
                        <img src="${spriteUrl}" alt="${escapeHtml(p.name)}" width="56" height="56"
                             style="image-rendering:pixelated"
                             onerror="this.src='${SPRITE_BASE}0.png'" />
                        <div class="poke-list-name">${escapeHtml(p.name)}</div>
                    </div>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    let html = '';

    if (POKEMON_BANNED.length === 0 && POKEMON_ALLOWED_SPECIAL.length === 0) {
        html = `
            <div class="poke-list-pending">
                <span style="font-size:2.5rem">📋</span>
                <p>La lista de Pokémon permitidos y prohibidos se publicará próximamente.</p>
            </div>`;
    } else {
        html += buildSection(
            'Pokémon Prohibidos', '⛔',
            POKEMON_BANNED,
            'No se han especificado Pokémon prohibidos aún.',
            'banned'
        );
        html += buildSection(
            'Pokémon Especiales Permitidos', '✅',
            POKEMON_ALLOWED_SPECIAL,
            'No se han especificado Pokémon especiales aún.',
            'allowed'
        );
    }

    container.innerHTML = html;
}

// ===================== AUTH SYSTEM =====================

let authToken = null;
let authUser = null;

function showAuthModal() {
    document.getElementById('auth-modal-overlay').classList.add('visible');
}

function closeAuthModal() {
    document.getElementById('auth-modal-overlay').classList.remove('visible');
    document.getElementById('login-error').textContent = '';
    document.getElementById('register-error').textContent = '';
}

function switchAuthMode(mode) {
    document.getElementById('login-form').style.display = mode === 'login' ? '' : 'none';
    document.getElementById('register-form').style.display = mode === 'register' ? '' : 'none';
    document.querySelectorAll('.auth-tab').forEach(t => {
        t.classList.toggle('active', (mode === 'login' && t.textContent.includes('Entrar')) ||
                                     (mode === 'register' && t.textContent.includes('Crear')));
    });
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.error || 'Error'; return; }

        authToken = data.token;
        authUser = data.user;
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.user.username);
        localStorage.setItem('userId', data.user.id);
        localStorage.setItem('avatarUrl', data.user.avatar_url || '');
        updateAuthUI();
        closeAuthModal();
        loadTournament();
    } catch (err) {
        errorEl.textContent = 'Error de conexión';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('register-user').value.trim();
    const password = document.getElementById('register-pass').value;
    const errorEl = document.getElementById('register-error');
    errorEl.textContent = '';

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.error || 'Error'; return; }

        authToken = data.token;
        authUser = data.user;
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.user.username);
        localStorage.setItem('userId', data.user.id);
        localStorage.setItem('avatarUrl', data.user.avatar_url || '');
        updateAuthUI();
        closeAuthModal();
        loadTournament();
    } catch (err) {
        errorEl.textContent = 'Error de conexión';
    }
}

function logout() {
    authToken = null;
    authUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('userId');
    localStorage.removeItem('avatarUrl');
    updateAuthUI();
}

function restoreAuth() {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    const userId = localStorage.getItem('userId');
    const avatarUrl = localStorage.getItem('avatarUrl');
    if (token && username && userId) {
        authToken = token;
        authUser = { id: parseInt(userId), username, avatar_url: avatarUrl || null };
    }
    updateAuthUI();
}

function updateAuthUI() {
    const authBtn = document.getElementById('auth-btn');
    const profileEl = document.getElementById('user-profile');
    const usernameEl = document.getElementById('user-username');
    const avatarContainer = document.getElementById('user-avatar-container');
    const battlesUnauth = document.getElementById('battles-unauth');
    const battlesAuthTabs = document.getElementById('battles-auth-tabs');
    const bracketPanel = document.getElementById('bpanel-bracket');
    const adminPanel = document.getElementById('bracket-admin-panel');

    if (authUser) {
        authBtn.style.display = 'none';
        profileEl.style.display = 'flex';
        usernameEl.textContent = authUser.username;
        const initial = authUser.username.charAt(0).toUpperCase();
        avatarContainer.innerHTML = authUser.avatar_url
            ? `<img src="${authUser.avatar_url}" class="avatar-circle-img" alt="${initial}" onerror="this.parentNode.textContent='${initial}'">`
            : initial;
        battlesUnauth.style.display = 'none';
        battlesAuthTabs.style.display = '';
        bracketPanel.style.display = '';
        if (authUser.username.toLowerCase() === 'gabriellucifer22') {
            adminPanel.style.display = '';
        } else {
            adminPanel.style.display = 'none';
        }
    } else {
        authBtn.style.display = '';
        profileEl.style.display = 'none';
        battlesUnauth.style.display = '';
        battlesAuthTabs.style.display = 'none';
        bracketPanel.style.display = 'none';
        document.getElementById('bpanel-mymatches').style.display = 'none';
        adminPanel.style.display = 'none';
    }
}

// ===================== PROFILE SETTINGS =====================

let _pendingAvatarDataUrl = null;

function showProfileModal() {
    if (!authUser) return;
    const overlay = document.getElementById('profile-modal-overlay');
    overlay.classList.add('visible');

    // Populate avatar preview
    const preview = document.getElementById('profile-avatar-preview');
    const initial = authUser.username.charAt(0).toUpperCase();
    if (authUser.avatar_url) {
        preview.innerHTML = `<img src="${authUser.avatar_url}" class="avatar-circle-img" alt="${initial}">`;
    } else {
        preview.innerHTML = `<span class="profile-avatar-initial">${initial}</span>`;
    }
    _pendingAvatarDataUrl = authUser.avatar_url || null;

    // Pre-fill username
    document.getElementById('profile-new-username').value = authUser.username;
    document.getElementById('profile-username-pass').value = '';
    document.getElementById('profile-current-pass').value = '';
    document.getElementById('profile-new-pass').value = '';

    // Clear messages
    document.querySelectorAll('.profile-msg').forEach(el => { el.textContent = ''; el.className = 'profile-msg'; });
}

function closeProfileModal() {
    document.getElementById('profile-modal-overlay').classList.remove('visible');
}

function previewProfileAvatar(input) {
    if (!input.files || !input.files[0]) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        // Resize to max 128x128 to keep data URL small
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxSize = 128;
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                const ratio = Math.min(maxSize / w, maxSize / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/png');
            _pendingAvatarDataUrl = dataUrl;
            const preview = document.getElementById('profile-avatar-preview');
            preview.innerHTML = `<img src="${dataUrl}" class="avatar-circle-img" alt="avatar">`;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
}

function removeProfileAvatar() {
    _pendingAvatarDataUrl = null;
    const preview = document.getElementById('profile-avatar-preview');
    const initial = authUser ? authUser.username.charAt(0).toUpperCase() : '?';
    preview.innerHTML = `<span class="profile-avatar-initial">${initial}</span>`;
}

async function saveProfileAvatar() {
    const msgEl = document.getElementById('profile-avatar-msg');
    msgEl.textContent = 'Guardando...';
    msgEl.className = 'profile-msg';

    try {
        const res = await fetch('/api/auth/avatar', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ avatarUrl: _pendingAvatarDataUrl })
        });
        const data = await res.json();
        if (!res.ok) { msgEl.textContent = data.error || 'Error'; msgEl.className = 'profile-msg error'; return; }

        authUser.avatar_url = _pendingAvatarDataUrl;
        localStorage.setItem('avatarUrl', _pendingAvatarDataUrl || '');
        try { updateAuthUI(); } catch(e) { console.warn('UI update error:', e); }
        msgEl.textContent = '✅ Avatar actualizado';
        msgEl.className = 'profile-msg success';
        try { loadData(); } catch(e) {}
    } catch (err) {
        msgEl.textContent = 'Error de conexión';
        msgEl.className = 'profile-msg error';
    }
}

async function saveProfileUsername() {
    const msgEl = document.getElementById('profile-username-msg');
    const newUsername = document.getElementById('profile-new-username').value.trim();
    const password = document.getElementById('profile-username-pass').value;
    msgEl.textContent = '';
    msgEl.className = 'profile-msg';

    if (!newUsername || !password) {
        msgEl.textContent = 'Rellena ambos campos';
        msgEl.className = 'profile-msg error';
        return;
    }

    try {
        const res = await fetch('/api/auth/username', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ newUsername, password })
        });
        const data = await res.json();
        if (!res.ok) { msgEl.textContent = data.error || 'Error'; msgEl.className = 'profile-msg error'; return; }

        authToken = data.token;
        authUser.username = data.username;
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.username);
        try { updateAuthUI(); } catch(e) { console.warn('UI update error:', e); }
        document.getElementById('profile-username-pass').value = '';
        msgEl.textContent = '✅ Nombre actualizado';
        msgEl.className = 'profile-msg success';
        try { loadData(); } catch(e) {}
    } catch (err) {
        msgEl.textContent = 'Error de conexión';
        msgEl.className = 'profile-msg error';
    }
}

async function saveProfilePassword() {
    const msgEl = document.getElementById('profile-password-msg');
    const currentPassword = document.getElementById('profile-current-pass').value;
    const newPassword = document.getElementById('profile-new-pass').value;
    msgEl.textContent = '';
    msgEl.className = 'profile-msg';

    if (!currentPassword || !newPassword) {
        msgEl.textContent = 'Rellena ambos campos';
        msgEl.className = 'profile-msg error';
        return;
    }

    try {
        const res = await fetch('/api/auth/password', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (!res.ok) { msgEl.textContent = data.error || 'Error'; msgEl.className = 'profile-msg error'; return; }

        document.getElementById('profile-current-pass').value = '';
        document.getElementById('profile-new-pass').value = '';
        msgEl.textContent = '✅ Contraseña actualizada';
        msgEl.className = 'profile-msg success';
    } catch (err) {
        msgEl.textContent = 'Error de conexión';
        msgEl.className = 'profile-msg error';
    }
}

// ===================== BATTLES TAB =====================

let activeBattlesTab = 'bracket';
let tournamentState = null;

function switchBattlesTab(tab) {
    activeBattlesTab = tab;
    document.querySelectorAll('.battles-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.btab === tab);
    });
    document.getElementById('bpanel-bracket').style.display = tab === 'bracket' ? '' : 'none';
    document.getElementById('bpanel-mymatches').style.display = tab === 'mymatches' ? '' : 'none';

    if (tab === 'mymatches') loadMyMatches();
    if (tab === 'bracket') loadTournament();
}

// ===================== TOURNAMENT (SWISS FORMAT) =====================

async function loadTournament() {
    try {
        const res = await fetch('/api/tournament');
        tournamentState = await res.json();
        renderSwissTournament();
    } catch (err) {
        console.error('Error loading tournament:', err);
    }
}

function renderSwissTournament() {
    const standingsEl = document.getElementById('swiss-standings');
    const roundsEl = document.getElementById('swiss-rounds');
    const championBanner = document.getElementById('swiss-champion-banner');
    const adminActions = document.getElementById('swiss-admin-actions');

    if (!standingsEl || !roundsEl) return;

    if (!tournamentState || !tournamentState.status) {
        standingsEl.innerHTML = '<p class="bracket-empty">No hay torneo activo. El admin debe generar uno.</p>';
        roundsEl.innerHTML = '';
        if (championBanner) championBanner.style.display = 'none';
        if (adminActions) adminActions.style.display = 'none';
        return;
    }

    // Champion Banner
    if (championBanner) {
        if (tournamentState.status === 'finished' && tournamentState.champion) {
            const c = tournamentState.champion;
            championBanner.innerHTML = `
                <div class="champion-content">
                    <div class="champion-trophy">🏆</div>
                    <div class="champion-info">
                        <div class="champion-label">¡CAMPEÓN DEL TORNEO!</div>
                        <div class="champion-name">
                            ${renderSmallAvatar(c)}
                            <span>${escapeHtml(c.username)}</span>
                        </div>
                    </div>
                </div>`;
            championBanner.style.display = '';
        } else {
            championBanner.style.display = 'none';
        }
    }

    // Admin advance button
    const isAdmin = authUser && authUser.username.toLowerCase() === 'gabriellucifer22';
    if (adminActions) {
        if (isAdmin && tournamentState.status === 'active') {
            adminActions.style.display = '';
            const currentRound = tournamentState.rounds.find(r => r.roundNumber === tournamentState.currentRound);
            const allCompleted = currentRound && currentRound.matches.every(m => m.status === 'completed');
            const btn = document.getElementById('swiss-advance-btn');
            if (btn) {
                btn.disabled = !allCompleted;
                btn.textContent = allCompleted
                    ? `⏭️ Avanzar a Ronda ${tournamentState.currentRound + 1}`
                    : `⏳ Esperando resultados de Ronda ${tournamentState.currentRound}...`;
            }
        } else {
            adminActions.style.display = 'none';
        }
    }

    // Render Standings
    renderSwissStandings(standingsEl);

    // Render Rounds (newest first)
    renderSwissRounds(roundsEl);
}

function renderSwissStandings(container) {
    const players = tournamentState.players || [];
    // Sort: active first, then by wins (desc), then by losses (asc)
    const sorted = [...players].sort((a, b) => {
        if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
        if (a.wins !== b.wins) return b.wins - a.wins;
        return a.losses - b.losses;
    });

    let html = '<div class="swiss-table">';
    html += `<div class="swiss-table-header">
        <span class="swiss-col-rank">#</span>
        <span class="swiss-col-player">Jugador</span>
        <span class="swiss-col-record">Récord</span>
        <span class="swiss-col-status">Estado</span>
    </div>`;

    sorted.forEach((p, i) => {
        const rank = i + 1;
        const recordClass = p.eliminated ? 'swiss-eliminated' : '';
        const wlClass = p.losses === 0 ? 'swiss-record-clean' :
                        p.losses === 1 ? 'swiss-record-ok' :
                        p.losses === 2 ? 'swiss-record-danger' : 'swiss-record-out';

        let statusBadge = '';
        if (p.eliminated) {
            statusBadge = '<span class="swiss-badge swiss-badge-eliminated">ELIMINADO</span>';
        } else if (tournamentState.champion && tournamentState.champion.id === p.id) {
            statusBadge = '<span class="swiss-badge swiss-badge-champion">🏆 CAMPEÓN</span>';
        } else {
            statusBadge = '<span class="swiss-badge swiss-badge-active">ACTIVO</span>';
        }

        html += `
        <div class="swiss-table-row ${p.eliminated ? 'swiss-row-eliminated' : ''}">
            <span class="swiss-col-rank">${rank}</span>
            <span class="swiss-col-player">
                ${renderSmallAvatar(p)}
                <span class="swiss-player-name">${escapeHtml(p.username)}</span>
                ${p.byeReceived ? '<span class="swiss-bye-tag">BYE</span>' : ''}
            </span>
            <span class="swiss-col-record ${wlClass}">${p.wins} - ${p.losses}</span>
            <span class="swiss-col-status">${statusBadge}</span>
        </div>`;
    });

    html += '</div>';
    container.innerHTML = html;
}

function renderSwissRounds(container) {
    const rounds = tournamentState.rounds || [];
    if (rounds.length === 0) {
        container.innerHTML = '<p class="bracket-empty">Sin rondas todavía.</p>';
        return;
    }

    const isAdmin = authUser && authUser.username.toLowerCase() === 'gabriellucifer22';

    // Render rounds in reverse order (newest first)
    let html = '';
    for (let i = rounds.length - 1; i >= 0; i--) {
        const round = rounds[i];
        const isCurrent = round.roundNumber === tournamentState.currentRound && tournamentState.status === 'active';

        html += `<div class="swiss-round ${isCurrent ? 'swiss-round-current' : ''}">`;
        html += `<div class="swiss-round-header">
            <span class="swiss-round-label">Ronda ${round.roundNumber}</span>
            ${isCurrent ? '<span class="swiss-round-badge">EN CURSO</span>' : '<span class="swiss-round-badge swiss-round-done">COMPLETADA</span>'}
        </div>`;

        // BYE info
        if (round.bye) {
            html += `<div class="swiss-bye-card">
                ${renderSmallAvatar(round.bye)}
                <span>${escapeHtml(round.bye.username)}</span>
                <span class="swiss-bye-label">BYE (victoria automática)</span>
            </div>`;
        }

        html += '<div class="swiss-round-matches">';
        for (const match of round.matches) {
            html += renderSwissMatchCard(match, isAdmin);
        }
        html += '</div></div>';
    }

    container.innerHTML = html;
}

function renderSwissMatchCard(match, isAdmin) {
    const p1 = match.player1;
    const p2 = match.player2;
    const p1Name = p1 ? escapeHtml(p1.username) : '—';
    const p2Name = p2 ? escapeHtml(p2.username) : '—';

    const isP1Winner = match.winnerId && p1 && match.winnerId === p1.id;
    const isP2Winner = match.winnerId && p2 && match.winnerId === p2.id;
    const isCompleted = match.status === 'completed';

    let statusIcon = '';
    if (match.status === 'conflict') statusIcon = '<span class="tb-status-icon conflict" title="Conflicto">⚠️</span>';
    else if (match.status === 'waiting_opponent') statusIcon = '<span class="tb-status-icon waiting" title="Esperando">⏳</span>';

    let adminHtml = '';
    if (isAdmin && (match.status === 'conflict' || match.status === 'pending' || match.status === 'waiting_opponent') && p1 && p2) {
        adminHtml = `
            <div class="tb-admin">
                <button class="tb-admin-btn" onclick="adminOverrideMatch('${match.id}', 2, 0)" title="Victoria ${p1Name}">👑 ${p1Name}</button>
                <button class="tb-admin-btn" onclick="adminOverrideMatch('${match.id}', 0, 2)" title="Victoria ${p2Name}">👑 ${p2Name}</button>
            </div>`;
    }

    return `
        <div class="tb-match ${isCompleted ? 'tb-completed' : ''}" data-match-id="${match.id}">
            <div class="tb-player ${isP1Winner ? 'tb-winner' : ''} ${!p1 ? 'tb-empty' : ''}">
                ${p1 ? renderSmallAvatar(p1) : ''}
                <span class="tb-player-name">${p1Name}</span>
                <span class="tb-player-score">${isCompleted ? match.score.p1 : ''}</span>
            </div>
            <div class="tb-player ${isP2Winner ? 'tb-winner' : ''} ${!p2 ? 'tb-empty' : ''}">
                ${p2 ? renderSmallAvatar(p2) : ''}
                <span class="tb-player-name">${p2Name}</span>
                <span class="tb-player-score">${isCompleted ? match.score.p2 : ''}</span>
            </div>
            ${statusIcon}
            ${adminHtml}
        </div>
    `;
}

function renderSmallAvatar(player) {
    const initial = player.username.charAt(0).toUpperCase();
    if (player.avatar_url) {
        return `<div class="match-avatar"><img src="${player.avatar_url}" class="avatar-circle-img" alt="${initial}" onerror="this.parentNode.textContent='${initial}'"></div>`;
    }
    return `<div class="match-avatar">${initial}</div>`;
}


// ===================== MY MATCHES =====================

async function loadMyMatches() {
    if (!authToken) return;

    try {
        const res = await fetch('/api/tournament/my-matches', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        renderCurrentMatch(data.current);
        renderPastMatches(data.past);
    } catch (err) {
        console.error('Error loading my matches:', err);
    }
}

function renderCurrentMatch(match) {
    const container = document.getElementById('current-match-content');
    if (!container) return;

    if (!match) {
        container.innerHTML = '<p class="no-match-msg">No tienes enfrentamiento activo en este momento.</p>';
        return;
    }

    const userId = authUser.id;
    const isP1 = match.player1 && match.player1.id === userId;
    const opponent = isP1 ? match.player2 : match.player1;
    const opponentName = opponent ? escapeHtml(opponent.username) : 'BYE';

    const bracketLabel = match.roundNumber ? `⚔️ Ronda ${match.roundNumber}` : '⚔️ Torneo';

    let statusHtml = '';
    const myReport = match.reports ? match.reports[userId] : null;

    if (myReport && match.status === 'waiting_opponent') {
        statusHtml = '<div class="my-match-status waiting">⏳ Has reportado tu resultado. Esperando a tu rival...</div>';
    } else if (match.status === 'conflict') {
        statusHtml = '<div class="my-match-status conflict">⚠️ Conflicto en los resultados. El admin decidirá el ganador.</div>';
    }

    let reportHtml = '';

    if (!myReport && (match.status === 'pending' || match.status === 'waiting_opponent' || match.status === 'conflict')) {
        reportHtml = `
            <div class="report-form">
                <h4>📋 Reportar resultado (Bo3)</h4>
                <p class="report-hint">Selecciona el resultado de tu serie:</p>
                <div class="score-buttons">
                    <button class="score-btn win" onclick="reportResult('${match.id}', 2, 0)">🏆 Gané 2 - 0</button>
                    <button class="score-btn win" onclick="reportResult('${match.id}', 2, 1)">🏆 Gané 2 - 1</button>
                    <button class="score-btn lose" onclick="reportResult('${match.id}', 1, 2)">💀 Perdí 1 - 2</button>
                    <button class="score-btn lose" onclick="reportResult('${match.id}', 0, 2)">💀 Perdí 0 - 2</button>
                </div>
            </div>
        `;
    } else if (myReport) {
        const myScore = isP1 ? myReport.p1 : myReport.p2;
        const enScore = isP1 ? myReport.p2 : myReport.p1;
        reportHtml = `<div class="my-report-sent">✅ Ya has reportado: <strong>${myScore} - ${enScore}</strong></div>`;
    }

    container.innerHTML = `
        <div class="current-match-card">
            <div class="current-match-bracket">${bracketLabel}</div>
            <div class="current-match-vs">
                <div class="current-match-player you">
                    ${renderSmallAvatar(authUser)}
                    <span>${escapeHtml(authUser.username)}</span>
                    <span class="you-badge">TÚ</span>
                </div>
                <div class="current-match-separator">VS</div>
                <div class="current-match-player opponent">
                    ${opponent ? renderSmallAvatar(opponent) : ''}
                    <span>${opponentName}</span>
                </div>
            </div>
            ${statusHtml}
            ${reportHtml}
        </div>
    `;
}

function renderPastMatches(matches) {
    const container = document.getElementById('past-matches-content');
    if (!container) return;

    if (!matches || matches.length === 0) {
        container.innerHTML = '<p class="no-match-msg">Sin enfrentamientos pasados.</p>';
        return;
    }

    const userId = authUser.id;

    let html = '';
    matches.forEach(match => {
        const isP1 = match.player1 && match.player1.id === userId;
        const opponent = isP1 ? match.player2 : match.player1;
        const opponentName = opponent ? escapeHtml(opponent.username) : 'BYE';
        const won = match.winnerId === userId;
        const myScore = isP1 ? match.score.p1 : match.score.p2;
        const opScore = isP1 ? match.score.p2 : match.score.p1;
        const bracketLabel = match.roundNumber ? `Ronda ${match.roundNumber}` : 'Torneo';

        html += `
            <div class="past-match-row ${won ? 'past-win' : 'past-loss'}">
                <span class="past-result-icon">${won ? '🏆' : '💀'}</span>
                ${opponent ? renderSmallAvatar(opponent) : ''}
                <span class="past-opponent">${opponentName}</span>
                <span class="past-score">${myScore} - ${opScore}</span>
                <span class="past-bracket">${bracketLabel}</span>
                ${match.adminOverride ? '<span class="past-admin">👑 Admin</span>' : ''}
            </div>
        `;
    });

    container.innerHTML = html;
}

// ===================== REPORT & ADMIN ACTIONS =====================

async function reportResult(matchId, myScore, enemyScore) {
    if (!authToken) return;

    try {
        const res = await fetch('/api/tournament/report', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ matchId, myScore, enemyScore })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Error al reportar');
            return;
        }
        loadMyMatches();
        loadTournament();
    } catch (err) {
        alert('Error de conexión');
    }
}

async function adminOverrideMatch(matchId, p1Wins, p2Wins) {
    if (!authToken) return;
    if (!confirm(`¿Forzar resultado ${p1Wins} - ${p2Wins}?`)) return;

    try {
        const res = await fetch('/api/tournament/admin/override', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ matchId, p1Wins, p2Wins })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Error');
            return;
        }
        loadTournament();
        loadMyMatches();
    } catch (err) {
        alert('Error de conexión');
    }
}

async function adminAdvanceRound() {
    if (!authToken) return;
    if (!confirm('¿Avanzar a la siguiente ronda? Todos los partidos deben estar completados.')) return;

    try {
        const res = await fetch('/api/tournament/advance-round', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Error');
            return;
        }
        if (data.message) alert(data.message);
        loadTournament();
        loadMyMatches();
    } catch (err) {
        alert('Error de conexión');
    }
}

// ===================== TOURNAMENT CREATOR (Admin Drag & Drop) =====================

let tcAvailablePlayers = [];
let tcSelectedPlayers = [];
let tcDraggedPlayerId = null;
let tcDragSource = null; // 'available' or 'selected'

function toggleTournamentCreator() {
    const panel = document.getElementById('tournament-creator');
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? '' : 'none';
    if (isHidden) loadTournamentPlayers();
}

async function loadTournamentPlayers() {
    if (!authToken) return;
    try {
        const res = await fetch('/api/tournament/players', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const players = await res.json();
        // Place all in available, keep existing selected if any
        const selectedIds = new Set(tcSelectedPlayers.map(p => p.id));
        tcAvailablePlayers = players.filter(p => !selectedIds.has(p.id));
        // Keep only selected players that still exist
        const allIds = new Set(players.map(p => p.id));
        tcSelectedPlayers = tcSelectedPlayers.filter(p => allIds.has(p.id));
        tcRenderBothLists();
    } catch (err) {
        console.error('Error loading players:', err);
    }
}

function tcRenderBothLists() {
    tcRenderList('tc-available-list', tcAvailablePlayers, 'available');
    tcRenderList('tc-selected-list', tcSelectedPlayers, 'selected');
    document.getElementById('tc-available-count').textContent = tcAvailablePlayers.length;
    document.getElementById('tc-selected-count').textContent = tcSelectedPlayers.length;
    document.getElementById('tc-generate-count').textContent = tcSelectedPlayers.length;

    const genBtn = document.getElementById('tc-generate-btn');
    genBtn.disabled = tcSelectedPlayers.length < 2;

    // Show/hide placeholders
    document.getElementById('tc-available-placeholder').style.display = tcAvailablePlayers.length === 0 ? '' : 'none';
    document.getElementById('tc-selected-placeholder').style.display = tcSelectedPlayers.length === 0 ? '' : 'none';
}

function tcRenderList(containerId, players, listType) {
    const container = document.getElementById(containerId);
    let html = '';
    players.forEach((p, idx) => {
        const initial = p.username.charAt(0).toUpperCase();
        const avatarHtml = p.avatar_url
            ? `<img src="${p.avatar_url}" class="avatar-circle-img" alt="${initial}" onerror="this.parentNode.textContent='${initial}'">`
            : initial;
        const seedBadge = listType === 'selected' ? `<span class="tc-seed">#${idx + 1}</span>` : '';
        html += `
            <div class="tc-player-card"
                 draggable="true"
                 data-player-id="${p.id}"
                 data-list-type="${listType}"
                 ondragstart="tcDragStart(event, ${p.id}, '${listType}')"
                 ondragend="tcDragEnd(event)"
                 onclick="tcClickTransfer(${p.id}, '${listType}')">
                <div class="tc-player-avatar">${avatarHtml}</div>
                <span class="tc-player-name">${escapeHtml(p.username)}</span>
                ${seedBadge}
                <span class="tc-transfer-icon">${listType === 'available' ? '→' : '←'}</span>
            </div>`;
    });
    container.innerHTML = html;
}

function tcClickTransfer(playerId, fromList) {
    if (fromList === 'available') {
        const idx = tcAvailablePlayers.findIndex(p => p.id === playerId);
        if (idx === -1) return;
        const [player] = tcAvailablePlayers.splice(idx, 1);
        tcSelectedPlayers.push(player);
    } else {
        const idx = tcSelectedPlayers.findIndex(p => p.id === playerId);
        if (idx === -1) return;
        const [player] = tcSelectedPlayers.splice(idx, 1);
        tcAvailablePlayers.push(player);
        tcAvailablePlayers.sort((a, b) => a.username.localeCompare(b.username));
    }
    tcRenderBothLists();
}

function tcDragStart(e, playerId, source) {
    tcDraggedPlayerId = playerId;
    tcDragSource = source;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', playerId);
    e.target.classList.add('tc-dragging');
}

function tcDragEnd(e) {
    e.target.classList.remove('tc-dragging');
    document.querySelectorAll('.tc-drop-zone').forEach(z => z.classList.remove('tc-drag-over'));
    tcDraggedPlayerId = null;
    tcDragSource = null;
}

function tcDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('tc-drag-over');
}

function tcDragLeave(e) {
    e.currentTarget.classList.remove('tc-drag-over');
}

function tcDropToAvailable(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('tc-drag-over');
    if (tcDragSource === 'selected' && tcDraggedPlayerId !== null) {
        tcClickTransfer(tcDraggedPlayerId, 'selected');
    }
}

function tcDropToSelected(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('tc-drag-over');
    if (tcDragSource === 'available' && tcDraggedPlayerId !== null) {
        tcClickTransfer(tcDraggedPlayerId, 'available');
    }
}

function tcSelectAll() {
    tcSelectedPlayers = tcSelectedPlayers.concat(tcAvailablePlayers);
    tcAvailablePlayers = [];
    tcRenderBothLists();
}

function tcClearAll() {
    tcAvailablePlayers = tcAvailablePlayers.concat(tcSelectedPlayers);
    tcSelectedPlayers = [];
    tcAvailablePlayers.sort((a, b) => a.username.localeCompare(b.username));
    tcRenderBothLists();
}

function tcShuffleSelected() {
    for (let i = tcSelectedPlayers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tcSelectedPlayers[i], tcSelectedPlayers[j]] = [tcSelectedPlayers[j], tcSelectedPlayers[i]];
    }
    tcRenderBothLists();
}

async function adminGenerateTournament() {
    if (!authToken) return;
    if (tcSelectedPlayers.length < 2) {
        alert('Necesitas al menos 2 jugadores seleccionados.');
        return;
    }
    if (!confirm(`¿Generar un nuevo torneo con ${tcSelectedPlayers.length} jugadores? Esto reemplazará el torneo actual.`)) return;

    const playerIds = tcSelectedPlayers.map(p => p.id);

    try {
        const res = await fetch('/api/tournament/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ playerIds })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Error');
            return;
        }
        // Close creator panel and reload bracket
        document.getElementById('tournament-creator').style.display = 'none';
        loadTournament();
    } catch (err) {
        alert('Error de conexión');
    }
}

async function adminResetTournament() {
    if (!authToken) return;
    if (!confirm('¿Estás seguro de que quieres RESETEAR el torneo actual? Se perderán todos los resultados.')) return;

    try {
        const res = await fetch('/api/tournament/reset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Error');
            return;
        }
        loadTournament();
    } catch (err) {
        alert('Error de conexión');
    }
}

