// Справочные статьи раздела «Теория». TeX в $…$ и $$…$$ рендерится KaTeX.
const S = String.raw;
const svgPairs = S`<svg class="ref-svg" viewBox="0 0 330 90" aria-hidden="true">
<g fill="none" stroke="#1f2430" stroke-width="2"><line x1="15" y1="62" x2="55" y2="30"/><line x1="55" y1="30" x2="95" y2="62"/><circle cx="55" cy="30" r="6" fill="#fff"/></g>
<text x="55" y="85" text-anchor="middle" font-size="11">В (R)</text>
<g fill="none" stroke="#1f2430" stroke-width="2"><line x1="125" y1="55" x2="215" y2="55"/><rect x="150" y="36" width="34" height="19" fill="#fff"/><line x1="167" y1="36" x2="185" y2="12"/></g>
<text x="170" y="85" text-anchor="middle" font-size="11">П (P)</text>
<g fill="none" stroke="#1f2430" stroke-width="2"><circle cx="265" cy="40" r="22"/><circle cx="305" cy="40" r="18"/></g><circle cx="287" cy="40" r="3" fill="#e11d48"/>
<text x="285" y="85" text-anchor="middle" font-size="11">высшая / higher</text></svg>`;
const svgFourbar = S`<svg class="ref-svg" viewBox="0 0 300 120" aria-hidden="true">
<g stroke="#1f2430" stroke-width="2.5" fill="none"><line x1="40" y1="95" x2="85" y2="45"/><line x1="85" y1="45" x2="215" y2="30"/><line x1="215" y1="30" x2="250" y2="95"/></g>
<line x1="40" y1="95" x2="250" y2="95" stroke="#9aa3b2" stroke-dasharray="6 4" stroke-width="2"/>
<g fill="#fff" stroke="#1f2430" stroke-width="2"><circle cx="40" cy="95" r="5"/><circle cx="250" cy="95" r="5"/><circle cx="85" cy="45" r="5"/><circle cx="215" cy="30" r="5"/></g>
<g font-size="12" fill="#1f2430"><text x="48" y="65">b</text><text x="145" y="30">c</text><text x="240" y="60">d</text><text x="140" y="112">a (стойка / frame)</text>
<text x="20" y="100">O₁</text><text x="258" y="100">O₂</text><text x="75" y="38">A</text><text x="218" y="22">B</text></g>
<path d="M 205 44 A 16 16 0 0 1 226 47" stroke="#2563eb" fill="none" stroke-width="1.5"/><text x="226" y="58" fill="#2563eb" font-size="12">μ</text></svg>`;
const svgDyads = S`<svg class="ref-svg" viewBox="0 0 420 80" aria-hidden="true"><g font-size="11" text-anchor="middle" fill="#1f2430">
<text x="42" y="76">1 ВВВ</text><text x="126" y="76">2 ВВП</text><text x="210" y="76">3 ВПВ</text><text x="294" y="76">4 ПВП</text><text x="378" y="76">5 ВПП</text></g>
<g stroke="#1f2430" stroke-width="2" fill="none">
<polyline points="15,55 42,18 69,55"/><circle cx="15" cy="55" r="4" fill="#fff"/><circle cx="42" cy="18" r="4" fill="#fff"/><circle cx="69" cy="55" r="4" fill="#fff"/>
<polyline points="99,55 126,18 150,52"/><circle cx="99" cy="55" r="4" fill="#fff"/><circle cx="126" cy="18" r="4" fill="#fff"/><rect x="141" y="46" width="18" height="10" fill="#fff"/><line x1="133" y1="60" x2="167" y2="60"/>
<line x1="183" y1="55" x2="237" y2="15"/><rect x="200" y="28" width="16" height="10" transform="rotate(-36 208 33)" fill="#fff"/><circle cx="183" cy="55" r="4" fill="#fff"/><line x1="208" y1="33" x2="215" y2="52"/><circle cx="215" cy="55" r="4" fill="#fff"/>
<line x1="270" y1="58" x2="318" y2="58"/><rect x="276" y="48" width="16" height="10" fill="#fff"/><polyline points="284,48 300,20 316,40"/><circle cx="300" cy="20" r="4" fill="#fff"/><line x1="306" y1="28" x2="328" y2="52"/><rect x="309" y="33" width="16" height="10" transform="rotate(47 317 38)" fill="#fff"/>
<circle cx="352" cy="55" r="4" fill="#fff"/><line x1="352" y1="55" x2="378" y2="20"/><rect x="363" y="28" width="16" height="10" transform="rotate(-53 371 33)" fill="#fff"/><line x1="371" y1="33" x2="398" y2="40"/><rect x="392" y="42" width="16" height="10" fill="#fff"/><line x1="384" y1="56" x2="414" y2="56"/>
</g></svg>`;
const svgPressure = S`<svg class="ref-svg" viewBox="0 0 260 130" aria-hidden="true">
<circle cx="80" cy="85" r="38" fill="#dbe7ff" stroke="#2563eb" stroke-width="2"/><circle cx="80" cy="85" r="3"/>
<circle cx="104" cy="44" r="9" fill="#fff" stroke="#1f2430" stroke-width="2"/><line x1="104" y1="35" x2="104" y2="5" stroke="#1f2430" stroke-width="3"/>
<line x1="104" y1="44" x2="128" y2="2" stroke="#e11d48" stroke-width="1.6"/><line x1="104" y1="44" x2="104" y2="0" stroke="#9aa3b2" stroke-dasharray="4 3"/>
<path d="M104 22 A 22 22 0 0 0 115 25" stroke="#e11d48" fill="none"/><text x="118" y="22" font-size="13" fill="#e11d48">ϑ</text>
<g font-size="11" fill="#1f2430"><text x="140" y="40">n — нормаль к профилю</text><text x="140" y="56">v — скорость толкателя</text><text x="140" y="80">ϑ ≤ 30° (поступат.)</text><text x="140" y="96">ϑ ≤ 45° (коромысло)</text></g></svg>`;
const svgGear = S`<svg class="ref-svg" viewBox="0 0 280 120" aria-hidden="true">
<circle cx="80" cy="60" r="44" fill="none" stroke="#2563eb" stroke-width="2"/><circle cx="80" cy="60" r="44" fill="none" stroke="#2563eb" stroke-dasharray="3 3" stroke-width="1"/>
<circle cx="168" cy="60" r="44" fill="none" stroke="#16a34a" stroke-width="0"/><circle cx="168" cy="60" r="44" fill="none" stroke="#16a34a" stroke-width="2"/>
<line x1="80" y1="60" x2="168" y2="60" stroke="#9aa3b2" stroke-dasharray="5 4"/><circle cx="124" cy="60" r="3" fill="#e11d48"/>
<g font-size="12" fill="#1f2430"><text x="60" y="58">O₁</text><text x="172" y="58">O₂</text><text x="114" y="77">P</text><text x="98" y="112">a_w = r₁ + r₂</text><text x="40" y="20">d₁ = m z₁</text><text x="160" y="20">d₂ = m z₂</text></g></svg>`;

export const ARTICLES = {
  ru: [
    { id: 'pairs', title: 'Кинематические пары и их классы', html: S`
<p><b>Кинематическая пара</b> — подвижное соединение двух звеньев. Число условий связи $S$ определяет класс пары, подвижность пары $H = 6 - S$ (в пространстве).</p>
${svgPairs}
<ul><li><b>Низшие пары</b> — контакт по поверхности: вращательная (В) и поступательная (П). В плоском механизме это пары V класса $p_5$: одна подвижность, две связи.</li>
<li><b>Высшие пары</b> — контакт по линии или в точке: зубчатое зацепление, кулачок–толкатель. В плоскости — пары IV класса $p_4$: две подвижности (качение + скольжение), одна связь.</li>
<li><b>Замыкание пары</b>: геометрическое (формой элементов: шарнир, паз) или силовое (пружиной, весом — кулачок с роликом).</li></ul>
<p>Высшую пару можно заменить <b>заменяющим механизмом</b>: условное звено с двумя низшими парами в центрах кривизны профилей; подвижность при этом не меняется: $3\cdot1 - 2\cdot2 = -1$ — как у одной пары $p_4$.</p>` },
    { id: 'dof', title: 'Формулы Чебышёва и Сомова–Малышева', html: S`
<p>Пространственный механизм — <b>формула Сомова–Малышева</b>:</p>
$$W = 6n - 5p_5 - 4p_4 - 3p_3 - 2p_2 - p_1,$$
<p>где $n$ — число подвижных звеньев, $p_k$ — число пар $k$-го класса.</p>
<p>Плоский механизм (у каждого звена 3 степени свободы, пары V класса отнимают 2, IV класса — 1) — <b>формула Чебышёва</b>:</p>
$$W = 3n - 2p_5 - p_4.$$
<p><b>Избыточные связи</b> $q$ повторяют уже наложенные ограничения (например, параллелограмм с лишним шатуном): $W = 3n - 2p_5 - p_4 + q$. <b>Местные подвижности</b> $W_{\text{м}}$ не влияют на движение механизма (вращение ролика толкателя): их вычитают из результата.</p>
<p>Если $W = 1$ — нужно одно ведущее звено; $W = 0$ — ферма; $W < 0$ — статически неопределимая ферма.</p>` },
    { id: 'assur', title: 'Группы Ассура и класс механизма', html: S`
<p>По Л. В. Ассуру любой механизм образуется присоединением к <b>начальному механизму</b> (стойка + ведущее звено, механизм I класса) <b>структурных групп</b> нулевой подвижности:</p>
$$W_{\text{гр}} = 3n - 2p_5 = 0 \;\Rightarrow\; p_5 = \tfrac{3}{2}n,\quad n = 2, 4, 6\dots$$
<ul><li><b>Класс группы</b>: двухповодковая (диада, $n=2$, $p_5=3$) — II класс; группа с базовым звеном на три пары — III класс; с замкнутым подвижным четырёхугольником — IV класс.</li>
<li><b>Порядок</b> — число внешних пар, которыми группа присоединяется к механизму.</li>
<li><b>Вид</b> диады определяется сочетанием пар (внешняя–внутренняя–внешняя):</li></ul>
${svgDyads}
<p>Класс механизма — наивысший класс входящих групп. <b>Формула строения</b> показывает порядок присоединения, например $I(0,1) \to II(2,3) \to II(4,5)$.</p>` },
    { id: 'grashof', title: 'Условие Грасгофа (существование кривошипа)', html: S`
${svgFourbar}
<p>Пусть $s$ — длина кратчайшего звена шарнирного четырёхзвенника, $l$ — длиннейшего, $p, q$ — двух остальных (стойку тоже считаем). Хотя бы одно звено проворачивается полностью, если</p>
$$s + l \le p + q.$$
<ul><li>кратчайшее звено — прилегает к стойке: <b>кривошипно-коромысловый</b> механизм (кратчайшее — кривошип);</li>
<li>кратчайшее — стойка: <b>двухкривошипный</b>;</li><li>кратчайшее — шатун: <b>двухкоромысловый</b> (кривошипа нет);</li>
<li>$s + l > p + q$ — кривошипа нет ни при каком выборе стойки (тройное коромысло).</li></ul>
<p>Для кривошипно-ползунного механизма с дезаксиалом $e$ кривошип существует при $r + e \le l$.</p>` },
    { id: 'pressure', title: 'Угол передачи и угол давления', html: S`
<p><b>Угол давления</b> $\vartheta$ — угол между направлением силы, действующей на ведомое звено (по нормали в паре), и направлением скорости точки её приложения. <b>Угол передачи</b> $\mu = 90^\circ - \vartheta$; в четырёхзвеннике это угол между шатуном и коромыслом.</p>
${svgPressure}
<p>Чем меньше $\vartheta$, тем больше полезная составляющая силы и меньше потери на трение. Рекомендуют $\mu_{min} \ge 40^\circ$ для рычажных механизмов; для кулачков $\vartheta_{max} \le 30^\circ$ при поступательном толкателе и $\le 45^\circ$ при коромысловом — иначе возможно заклинивание.</p>
<p>Для кулачка с поступательным толкателем: $\;\tan\vartheta = \dfrac{s' - e}{s + \sqrt{r_0^2 - e^2}}$, где $s' = ds/d\varphi$, $r_0$ — радиус основной шайбы, $e$ — эксцентриситет.</p>` },
    { id: 'cam', title: 'Законы движения толкателя кулачка', html: S`
<p>Фаза подъёма на угол $\varphi_{\text{п}}$ с ходом $h$; $x = \varphi/\varphi_{\text{п}} \in [0, 1]$. Перемещение $s = h\,f(x)$, аналог скорости $s' = \frac{h}{\varphi_{\text{п}}} f'(x)$, аналог ускорения $s'' = \frac{h}{\varphi_{\text{п}}^2} f''(x)$.</p>
<ul><li><b>Равномерный</b> (линейный): $f = x$; скорость скачком — <b>жёсткий удар</b> (бесконечное ускорение) в начале и конце фазы.</li>
<li><b>Параболический</b> (равноускоренный): $f = 2x^2$ при $x \le \tfrac12$, $f = 1 - 2(1-x)^2$ при $x > \tfrac12$; ускорение скачком — <b>мягкий удар</b>.</li>
<li><b>Косинусоидальный</b> (гармонический): $f = \tfrac12\left(1 - \cos \pi x\right)$; мягкие удары на границах фазы.</li>
<li><b>Синусоидальный</b> (циклоидальный): $f = x - \dfrac{\sin 2\pi x}{2\pi}$; ускорение непрерывно — <b>безударный</b> закон.</li></ul>
<p>Фазы цикла: подъём $\varphi_{\text{п}}$, выстой $\varphi_{\text{вв}}$, опускание $\varphi_{\text{о}}$, выстой $\varphi_{\text{вн}}$; $\varphi_{\text{п}} + \varphi_{\text{вв}} + \varphi_{\text{о}} + \varphi_{\text{вн}} = 360^\circ$.</p>` },
    { id: 'gears', title: 'Зубчатые передачи: основные термины', html: S`
${svgGear}
<ul><li><b>Модуль</b> $m = p/\pi$, мм — где $p$ — шаг по делительной окружности; стандартизован (ГОСТ 9563).</li>
<li><b>Делительная окружность</b>: $d = m z$, $r = m z / 2$; межосевое расстояние $a_w = m(z_1 \pm z_2)/2$ («+» внешнее, «−» внутреннее зацепление).</li>
<li><b>Передаточное отношение</b>: $u_{12} = \dfrac{\omega_1}{\omega_2} = \mp \dfrac{z_2}{z_1}$ (минус — внешнее зацепление, колёса вращаются в разные стороны).</li>
<li><b>Реечная передача</b>: $v = \omega r = \omega m z / 2$.</li>
<li><b>Формула Виллиса</b> для планетарного механизма с водилом $H$ — передаточное отношение в обращённом движении:
$$u^{(H)}_{13} = \frac{\omega_1 - \omega_H}{\omega_3 - \omega_H} = (-1)^k \frac{\prod z_{\text{ведомых}}}{\prod z_{\text{ведущих}}},$$
где $k$ — число внешних зацеплений; для солнца 1, сателлита 2 и короны 3: $u^{(H)}_{13} = -z_3/z_1$. При неподвижном колесе 3: $u_{1H} = 1 - u^{(H)}_{13}$.</li></ul>` },
  ],
  en: [
    { id: 'pairs', title: 'Kinematic pairs and their classes', html: S`
<p>A <b>kinematic pair</b> is a movable connection of two links. The number of constraints $S$ gives the pair class; the pair mobility is $H = 6 - S$ (in space).</p>
${svgPairs}
<ul><li><b>Lower pairs</b> — surface contact: revolute (R) and prismatic (P). In a planar mechanism they are class V pairs $p_5$: one DOF, two constraints.</li>
<li><b>Higher pairs</b> — line or point contact: gear mesh, cam–follower. In the plane they are class IV pairs $p_4$: two DOF (rolling + sliding), one constraint.</li>
<li><b>Closure</b>: form closure (joint, slot) or force closure (spring, weight — a roller cam follower).</li></ul>
<p>A higher pair can be replaced by an <b>equivalent mechanism</b>: a virtual link with two lower pairs at the centres of curvature; mobility is unchanged: $3\cdot1 - 2\cdot2 = -1$, like one $p_4$.</p>` },
    { id: 'dof', title: 'Chebyshev and Somov–Malyshev formulas', html: S`
<p>Spatial mechanism — <b>Somov–Malyshev (Kutzbach) formula</b>:</p>
$$W = 6n - 5p_5 - 4p_4 - 3p_3 - 2p_2 - p_1,$$
<p>$n$ — moving links, $p_k$ — pairs of class $k$.</p>
<p>Planar mechanism — <b>Chebyshev (Grübler) formula</b>:</p>
$$W = 3n - 2p_5 - p_4.$$
<p><b>Redundant constraints</b> $q$ repeat existing ones: $W = 3n - 2p_5 - p_4 + q$. <b>Passive DOF</b> $W_p$ (e.g. roller spin) do not affect the mechanism and are subtracted.</p>
<p>$W = 1$ — one input link; $W = 0$ — a structure; $W < 0$ — an indeterminate structure.</p>` },
    { id: 'assur', title: 'Assur groups and mechanism class', html: S`
<p>Any mechanism is built by attaching zero-DOF <b>Assur groups</b> to the <b>initial mechanism</b> (frame + input link, class I):</p>
$$W_{g} = 3n - 2p_5 = 0 \;\Rightarrow\; p_5 = \tfrac{3}{2}n,\quad n = 2, 4, 6\dots$$
<ul><li><b>Class</b>: dyad ($n=2$, $p_5=3$) — class II; group with a ternary base link — class III; with a closed movable quadrilateral — class IV.</li>
<li><b>Order</b> — number of external pairs.</li><li><b>Type</b> of a dyad by its pairs (external–internal–external), R = В, P = П:</li></ul>
${svgDyads}
<p>The mechanism class is the highest group class. The <b>structure formula</b> shows the attachment order, e.g. $I(0,1) \to II(2,3) \to II(4,5)$.</p>` },
    { id: 'grashof', title: 'Grashof condition (crank existence)', html: S`
${svgFourbar}
<p>Let $s$ be the shortest link of a four-bar, $l$ the longest, $p, q$ the others (frame included). At least one link rotates fully if</p>
$$s + l \le p + q.$$
<ul><li>shortest link adjacent to the frame — <b>crank-rocker</b> (the shortest is the crank);</li><li>shortest is the frame — <b>double-crank</b>;</li>
<li>shortest is the coupler — <b>double-rocker</b> (no crank);</li><li>$s + l > p + q$ — no crank for any inversion (triple rocker).</li></ul>
<p>For an offset slider-crank with offset $e$ the crank exists if $r + e \le l$.</p>` },
    { id: 'pressure', title: 'Transmission angle and pressure angle', html: S`
<p>The <b>pressure angle</b> $\vartheta$ is the angle between the force on the driven link (along the contact normal) and the velocity of its point of application. The <b>transmission angle</b> $\mu = 90^\circ - \vartheta$; in a four-bar it is the angle between coupler and rocker.</p>
${svgPressure}
<p>Recommended: $\mu_{min} \ge 40^\circ$ for linkages; for cams $\vartheta_{max} \le 30^\circ$ (translating follower) and $\le 45^\circ$ (rocker follower), otherwise jamming is possible.</p>
<p>Translating follower: $\;\tan\vartheta = \dfrac{s' - e}{s + \sqrt{r_0^2 - e^2}}$, $s' = ds/d\varphi$, $r_0$ — base circle radius, $e$ — offset.</p>` },
    { id: 'cam', title: 'Cam follower motion laws', html: S`
<p>Rise over $\varphi_r$ with lift $h$, $x = \varphi/\varphi_r \in [0, 1]$: $s = h\,f(x)$, $s' = \frac{h}{\varphi_r} f'(x)$, $s'' = \frac{h}{\varphi_r^2} f''(x)$.</p>
<ul><li><b>Uniform</b>: $f = x$ — velocity jumps, <b>hard shock</b>.</li>
<li><b>Parabolic</b>: $f = 2x^2$ for $x \le \tfrac12$, $1 - 2(1-x)^2$ otherwise — acceleration jumps, <b>soft shock</b>.</li>
<li><b>Harmonic</b>: $f = \tfrac12(1 - \cos\pi x)$ — soft shocks at the ends.</li>
<li><b>Cycloidal</b>: $f = x - \dfrac{\sin 2\pi x}{2\pi}$ — continuous acceleration, <b>shock-free</b>.</li></ul>
<p>Cycle: rise, high dwell, return, low dwell; the angles sum to $360^\circ$.</p>` },
    { id: 'gears', title: 'Gears: basic terms', html: S`
${svgGear}
<ul><li><b>Module</b> $m = p/\pi$ (mm), $p$ — circular pitch.</li>
<li><b>Pitch circle</b>: $d = m z$; centre distance $a_w = m(z_1 \pm z_2)/2$ (+ external, − internal).</li>
<li><b>Gear ratio</b>: $u_{12} = \omega_1/\omega_2 = \mp z_2/z_1$ (minus — external mesh, opposite rotation).</li>
<li><b>Rack and pinion</b>: $v = \omega r = \omega m z/2$.</li>
<li><b>Willis formula</b> for a planetary train with carrier $H$:
$$u^{(H)}_{13} = \frac{\omega_1 - \omega_H}{\omega_3 - \omega_H} = (-1)^k \frac{\prod z_{\text{driven}}}{\prod z_{\text{driving}}},$$
$k$ — number of external meshes; for sun 1, planet 2 and ring 3: $u^{(H)}_{13} = -z_3/z_1$. With gear 3 fixed: $u_{1H} = 1 - u^{(H)}_{13}$.</li></ul>` },
  ],
};
