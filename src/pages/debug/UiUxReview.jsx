import { useMemo, useState } from 'react'
import styles from './UiUxReview.module.css'

const MOCKUPS = {
  dashboard: [
    { title: '01 Overview', note: '今日使える機能と次の1クリック', src: '/ux-mockups/dashboard-01-overview.png' },
    { title: '02 Detail', note: 'GA4/BigQuery初心者向けの設定導線', src: '/ux-mockups/dashboard-02-detail.png' },
  ],
  compare: [
    { title: '01 Input', note: '入力URLと比較対象だけを確認', src: '/ux-mockups/compare-01-input.png' },
    { title: '02 Markdown', note: '文章はMarkdown本文として読む', src: '/ux-mockups/compare-02-markdown.png' },
    { title: '03 Graphs', note: '差分はグラフで理解する', src: '/ux-mockups/compare-03-graphs.png' },
    { title: '04 Actions', note: '次アクションとAI質問', src: '/ux-mockups/compare-04-actions.png' },
  ],
  discovery: [
    { title: '01 Found', note: '発見した競合URLだけを見る', src: '/ux-mockups/discovery-01-found.png' },
    { title: '02 比較', note: '自社LPと競合の状態差', src: '/ux-mockups/discovery-02-compare.png' },
    { title: '03 Map', note: 'Position Mapで直感理解', src: '/ux-mockups/discovery-03-map.png' },
    { title: '04 Report', note: 'Markdown結論と次アクション', src: '/ux-mockups/discovery-04-report.png' },
  ],
  ads: [
    { title: '01 KPI', note: '期間選択とPython集計済みKPI', src: '/ux-mockups/ads-01-kpi.png' },
    { title: '02 CV', note: 'CVR・CPA・費用推移グラフ', src: '/ux-mockups/ads-02-cv-trends.png' },
    { title: '03 Traffic', note: '流入・LP・デバイス別グラフ', src: '/ux-mockups/ads-03-traffic-lp.png' },
    { title: '04 Raw Data', note: '表データ・異常検知・品質確認', src: '/ux-mockups/ads-04-raw-anomaly.png' },
    { title: '05 AI', note: 'グラフを見ながら右AIに質問', src: '/ux-mockups/ads-05-ai-question.png' },
  ],
  banner: [
    { title: '01 Overview', note: '架空バナー・総合スコア・最初の修正', src: '/ux-mockups/banner-01-overview.png' },
    { title: '02 Detail', note: 'Markdownレビュー・根拠・A/Bテスト案', src: '/ux-mockups/banner-02-detail.png' },
  ],
}

const tabs = [
  {
    key: 'dashboard',
    label: 'ダッシュボード',
    title: '運用ホーム',
    intent: '初見で今日使える機能と次に押すボタンが分かる状態へ寄せる。',
  },
  {
    key: 'compare',
    label: '競合LP分析',
    title: '比較レポート',
    intent: '自社LPと競合LPのURL入力後、比較差分を読みやすいHTML/MarkdownレポートとAI質問欄で確認する。',
  },
  {
    key: 'discovery',
    label: '競合発見',
    title: '発見レポート',
    intent: '競合分類の信頼性を最初に見せ、対象外を主比較から外したうえでAIに確認できるようにする。',
  },
  {
    key: 'ads',
    label: '広告グラフ / AI考察',
    title: 'AI考察',
    intent: '期間選択後にPython集計で作られた正確な数値と分析グラフを前提に、その読み解きをAIへ質問できるようにする。',
  },
  {
    key: 'banner',
    label: 'バナーレビュー',
    title: 'バナーレビュー',
    intent: '架空バナーのレビュー結果を、総合評価・最初の修正・根拠・検証案として迷わず読める形にする。',
  },
]

function DashboardPreview() {
  const features = [
    ['競合LP分析', '利用可', 'LP比較を始める'],
    ['競合発見', '利用可', '競合探索を始める'],
    ['バナーレビュー', 'デモのみ', '架空素材で確認'],
    ['GA4 BigQuery', '未接続', '保存先IDを設定'],
  ]
  const tasks = [
    'Hana NestのFV CTAを1案へ統一',
    '非指名広告の期待KPIをLP-CVRへ変更',
    '対象外URLを主比較から除外',
  ]
  return (
    <div className={styles.dashboardPreview} data-testid="dashboard-review-preview">
      <section className={styles.previewHero}>
        <div>
          <p className={styles.eyebrow}>Today</p>
          <h2>今日使える機能</h2>
          <p>未設定の機能は壊れた状態に見せず、次の1クリックへ落とします。</p>
        </div>
        <span className={styles.safeChip}>架空データ</span>
      </section>
      <div className={styles.featureGrid}>
        {features.map(([name, status, action]) => (
          <article key={name} className={styles.featureCard}>
            <span>{status}</span>
            <strong>{name}</strong>
            <small>{action}</small>
          </article>
        ))}
      </div>
      <section className={styles.nextBoard}>
        <div>
          <p className={styles.eyebrow}>Next Analysis</p>
          <h3>次にやる分析</h3>
        </div>
        {tasks.map((task, idx) => (
          <div key={task} className={styles.taskRow}>
            <b>{idx + 1}</b>
            <span>{task}</span>
          </div>
        ))}
      </section>
    </div>
  )
}

function SimpleMetric({ label, value }) {
  return (
    <div className={styles.simpleMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ReportWithChat({ children, chat }) {
  const [chatOpen, setChatOpen] = useState(true)

  return (
    <div className={`${styles.previewWithChat} ${chatOpen ? '' : styles.previewWithChatCollapsed}`}>
      <div className={styles.mainColumn}>{children}</div>
      <AiSidePanel {...chat} open={chatOpen} onToggle={() => setChatOpen((current) => !current)} />
    </div>
  )
}

function AiSidePanel({ title = 'AIに質問', context, prompts, answerTitle, answer, open, onToggle }) {
  return (
    <aside
      className={`${styles.chatPanel} ${open ? '' : styles.chatCollapsed}`}
      data-testid="ai-side-panel"
      aria-label={title}
    >
      <button
        type="button"
        className={styles.chatToggle}
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? 'AIチャットを閉じる' : 'AIチャットを開く'}
      </button>
      {open && (
        <div className={styles.chatBody}>
          <div>
            <p className={styles.eyebrow}>Assistant</p>
            <h3>{title}</h3>
            <p>{context}</p>
          </div>
          <div className={styles.promptChips}>
            {prompts.map((prompt) => (
              <button key={prompt} type="button">
                {prompt}
              </button>
            ))}
          </div>
          <div className={styles.chatBubble}>
            <strong>{answerTitle}</strong>
            <p>{answer}</p>
          </div>
        </div>
      )}
    </aside>
  )
}

function ComparePreview() {
  return (
    <div data-testid="compare-review-preview">
      <ReportWithChat
        chat={{
          context: '比較結果を見ながら、LP改善・広告文・計測のどこから直すかを質問できます。',
          prompts: ['最初に直す場所は？', '広告文へ落とす', '根拠だけ確認'],
          answerTitle: '回答例',
          answer:
            'FV内のCTAとオファーを先に揃えるのが最短です。競合は初回特典とCTAが同じ画面にあり、クリック後の迷いが少ない構造です。',
        }}
      >
        <section className={styles.simpleHero}>
          <p className={styles.eyebrow}>競合LP分析</p>
          <h2>比較レポート</h2>
          <p>自社LPと競合LPを入力すると、差分をHTML/Markdownで読みやすく整理します。</p>
          <button type="button">レポートを読む</button>
        </section>
        <div className={styles.urlSummary}>
          <div>
            <span>自社LP</span>
            <strong>Hana Nest</strong>
            <small>hana-nest.example/lp</small>
          </div>
          <div>
            <span>競合LP</span>
            <strong>Mori Cart / Kumo Living</strong>
            <small>2件を比較</small>
          </div>
        </div>
        <div className={styles.metricGrid}>
          <SimpleMetric label="強み" value="検索意図一致" />
          <SimpleMetric label="弱み" value="CTAが分散" />
          <SimpleMetric label="次の修正" value="FV整理" />
        </div>
        <section className={styles.reasonBox}>
          <h3>Markdownレポート</h3>
          <p>
            自社LPは検索意図と訴求は合っていますが、競合と比べて価格・CTA・信頼情報が分散しています。最初の修正はFV内のCTA統一です。
          </p>
        </section>
        <div className={styles.simpleTable}>
          <span>自社LP</span><b>CTA分散 / 信頼情報は下部</b>
          <span>競合LP</span><b>CTA明確 / オファーが上部</b>
        </div>
      </ReportWithChat>
    </div>
  )
}

function DiscoveryPreview() {
  const tiers = [
    ['直接競合', '2', '主比較'],
    ['隣接', '1', '補助'],
    ['参考', '1', '観測'],
    ['対象外', '1', '除外'],
  ]
  const rows = [
    ['Mori Cart', '直接競合', 'CTAとオファーが自社より明確'],
    ['Kumo Living', '直接競合', '信頼要素の見せ方が強い'],
    ['Nagi Market', '参考', '広域サイトのため観測のみ'],
    ['Sora Tool', '対象外', 'ツール系URLのため除外'],
  ]
  return (
    <div data-testid="discovery-review-preview">
      <ReportWithChat
        chat={{
          context: '発見候補の分類理由を確認し、対象外を混ぜずに次の比較へ進めます。',
          prompts: ['対象外の理由は？', '直接競合だけ表示', '比較へ進める'],
          answerTitle: '回答例',
          answer:
            'Sora Toolは検索/ツール系URLのため購買LP比較には使いません。主比較はHana NestとMori Cartの2件に絞るのが安全です。',
        }}
      >
        <section className={styles.simpleHero}>
          <p className={styles.eyebrow}>競合発見</p>
          <h2>競合発見レポート</h2>
          <p>発見した競合URLから、自社LPがどこで弱いかを確認します。</p>
        </section>
        <div className={styles.tierGrid}>
          {tiers.map(([label, count, note]) => (
            <div key={label} className={styles.tierCard}>
              <strong>{count}</strong>
              <span>{label}</span>
              <small>{note}</small>
            </div>
          ))}
        </div>
        <section className={styles.reasonBox}>
          <h3>## 要約</h3>
          <p>
            直接競合は2件です。自社LPは検索意図には合っていますが、競合と比べるとCTAの明確さと信頼要素の配置が弱く見えます。
          </p>
        </section>
        <section className={styles.chartPreview}>
          <div>
            <span style={{ height: '46%' }} />
            <span style={{ height: '68%' }} />
            <span style={{ height: '61%' }} />
            <span style={{ height: '24%', background: '#9aa49b' }} />
          </div>
          <p>自社LPと直接競合だけをグラフ化し、対象外URLは主比較に混ぜません。</p>
        </section>
        <div className={styles.simpleList}>
          {rows.map(([name, tier, action]) => (
            <div key={name} className={tier === '対象外' ? styles.mutedRow : styles.listRow}>
              <span>{name}</span>
              <b>{tier}</b>
              <small>{action}</small>
            </div>
          ))}
        </div>
      </ReportWithChat>
    </div>
  )
}

function AdsAiPreview() {
  const cards = [
    ['費用', '1,240,000円'],
    ['クリック', '18,420'],
    ['CV', '312'],
    ['CVR', '1.69%'],
    ['CPA', '3,974円'],
  ]
  const chartCards = [
    ['CVR推移', 'line', 'CVRが週後半に低下'],
    ['CPA推移', 'bar', 'CPAが直近3日で上昇'],
    ['チャネル別CV', 'bar', 'OrganicとPaidで差が拡大'],
    ['LP別CVR', 'bar', 'LP-Aだけ改善余地が大きい'],
  ]
  return (
    <div data-testid="ads-ai-review-preview">
      <ReportWithChat
        chat={{
          context: 'Python集計済みのグラフを見ながら、気になる変化を質問できます。',
          prompts: ['CVR低下の原因', 'CPA上昇の根拠', '見るべきグラフ'],
          answerTitle: '回答例',
          answer:
            'CVR推移とLP別CVRを見ると、CPA悪化はクリック単価よりLP-Aの転換率低下の影響が大きいです。次はLP-Aの流入元別CVRを確認します。',
        }}
      >
        <section className={styles.simpleHero}>
          <p className={styles.eyebrow}>広告グラフ / AI考察</p>
          <h2>Python集計グラフを見ながらAIに聞く</h2>
          <p>BigQueryから取得した数値をPythonで集計し、複数グラフを根拠に質問します。</p>
        </section>
        <div className={styles.pipeline}>
          <span>期間選択</span>
          <span>BigQuery取得</span>
          <span>Pythonで集計済み</span>
          <span>グラフ確認</span>
        </div>
        <section className={styles.adsGraphShell} aria-label="実装する分析グラフ画面の2カラム構成">
          <div className={styles.adsGraphMain}>
            <div className={styles.adsGraphHeader}>
              <div>
                <span>Python生成グラフ</span>
                <strong>分析グラフ</strong>
                <p>CV・CPA・流入・LP・生データを、下にスクロールしながら大きいグラフで確認します。</p>
              </div>
              <small>28 charts / 最新30日</small>
            </div>
            <div className={styles.adsGraphLarge}>
              <span style={{ height: '42%' }} />
              <span style={{ height: '64%' }} />
              <span style={{ height: '52%' }} />
              <span style={{ height: '78%' }} />
              <span style={{ height: '46%' }} />
              <span style={{ height: '70%' }} />
            </div>
            <div className={styles.adsGraphRows}>
              <span>CVR推移</span>
              <span>CPA推移</span>
              <span>LP別CVR</span>
            </div>
          </div>
          <aside className={styles.adsGraphRail}>
            <strong>AIグラフチャット</strong>
            <p>右カラムで、見ているグラフについて質問します。</p>
            <button type="button">CVR低下の原因は？</button>
            <button type="button">CPA悪化はLP由来？</button>
            <button type="button">次に見るグラフは？</button>
          </aside>
        </section>
        <div className={styles.answerGrid}>
          {cards.map(([title, body]) => (
            <article key={title} className={styles.answerCard}>
              <strong>{title}</strong>
              <p>{body}</p>
            </article>
          ))}
        </div>
        <div className={styles.graphGrid}>
          {chartCards.map(([title, type, note], idx) => (
            <article key={title} className={styles.graphCard}>
              <div>
                <strong>{title}</strong>
                <span>{type === 'line' ? '推移' : '比較'}</span>
              </div>
              <div className={type === 'line' ? styles.lineChart : styles.miniBars} aria-label={`${title} preview`}>
                <span style={{ height: `${38 + idx * 7}%` }} />
                <span style={{ height: `${58 - idx * 3}%` }} />
                <span style={{ height: `${44 + idx * 6}%` }} />
                <span style={{ height: `${64 - idx * 5}%` }} />
              </div>
              <p>{note}</p>
            </article>
          ))}
        </div>
        <section className={styles.reasonBox}>
          <h3>## グラフから見えること</h3>
          <p>CVR・CPA・チャネル・LP別の変化を同じ期間で見比べ、AI回答は必ず参照グラフに紐づけます。</p>
        </section>
      </ReportWithChat>
    </div>
  )
}

function BannerReviewPreview() {
  const reviewCards = [
    ['良い点', '価格訴求とCTAは1画面で理解できます。'],
    ['改善点', 'ベネフィットより割引率が先に見え、誰向けかが弱いです。'],
    ['根拠', 'CTA視認性は高い一方、商品価値の説明が1行だけです。'],
    ['検証案', '訴求違い2案を同一配信条件でA/Bテストします。'],
  ]
  return (
    <div data-testid="banner-review-preview">
      <ReportWithChat
        chat={{
          context: 'レビュー結果を見ながら、改善コピー・LPとのズレ・A/Bテスト案へ変換できます。',
          prompts: ['改善案を広告文に', 'LPとのズレは？', 'A/B案を作る'],
          answerTitle: '回答例',
          answer:
            '広告文にするなら「小さな部屋にも置ける、週末限定ソファフェア」のように、利用シーンとキャンペーンを同時に出すのが良いです。',
        }}
      >
        <section className={styles.simpleHero}>
          <p className={styles.eyebrow}>バナーレビュー</p>
          <h2>バナーレビュー</h2>
          <p>検証用の架空デモ素材を、広告運用の観点で読みやすいレポートにします。</p>
        </section>
        <div className={styles.bannerSummary}>
          <div className={styles.creativeThumb}>
            <span>架空バナー</span>
            <strong>Kiri Sofa Fair</strong>
            <small>300x250 / demo_creative: true</small>
          </div>
          <div className={styles.scoreBand}>
            <span>総合スコア</span>
            <strong>78</strong>
            <small>最初の修正: ターゲット訴求を1行追加</small>
          </div>
        </div>
        <div className={styles.reviewCards}>
          {reviewCards.map(([title, body]) => (
            <article key={title}>
              <strong>{title}</strong>
              <p>{body}</p>
            </article>
          ))}
        </div>
        <section className={styles.reasonBox}>
          <h3>Markdownレポート</h3>
          <p>
            このクリエイティブは架空の検証用素材です。訴求の主役を「割引」から「小さな部屋でも置ける」に寄せると、広告文とLPの一貫性を高めやすくなります。
          </p>
        </section>
      </ReportWithChat>
    </div>
  )
}

function ImplementationPreview({ activeKey }) {
  if (activeKey === 'dashboard') return <DashboardPreview />
  if (activeKey === 'ads') return <AdsAiPreview />
  if (activeKey === 'discovery') return <DiscoveryPreview />
  if (activeKey === 'banner') return <BannerReviewPreview />
  return <ComparePreview />
}

export default function UiUxReview() {
  const [activeKey, setActiveKey] = useState('dashboard')
  const active = useMemo(() => tabs.find((tab) => tab.key === activeKey) || tabs[0], [activeKey])

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>GPT Image2 方向性レビュー</p>
          <h1>Insight Studio UI/UX 再設計レビュー</h1>
          <p>左に生成モック、右にReact実装プレビューを並べ、5画面の判断ボード化を確認します。</p>
        </div>
        <span className={styles.safeChip}>実在企業素材なし</span>
      </header>

      <nav className={styles.tabs} role="tablist" aria-label="UI/UX review tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeKey === tab.key}
            className={activeKey === tab.key ? styles.tabActive : styles.tab}
            onClick={() => setActiveKey(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className={styles.reviewGrid} aria-label={`${active.label} review`}>
        <article className={styles.mockPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>画像モック</p>
              <h2>{active.title} GPT Image2モック</h2>
              <p>情報量を分けるため、下へスクロールして複数枚構成で確認します。</p>
            </div>
          </div>
          <div className={styles.mockStack}>
            {MOCKUPS[active.key].map((mockup) => (
              <figure key={mockup.src} className={styles.mockCard}>
                <figcaption>
                  <strong>{mockup.title}</strong>
                  <span>{mockup.note}</span>
                </figcaption>
                <img src={mockup.src} alt={`${active.label} ${mockup.title} GPT Image2 UI direction mockup`} />
              </figure>
            ))}
          </div>
        </article>

        <article className={styles.previewPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>React実装プレビュー</p>
              <h2>{active.title} 実装プレビュー</h2>
            </div>
          </div>
          <ImplementationPreview activeKey={active.key} />
        </article>
      </section>

      <section className={styles.intentPanel}>
        <p className={styles.eyebrow}>改善意図</p>
        <h2>{active.intent}</h2>
        <p>
          このレビュー画面は架空データのみを使っています。GPT Image2の画像は方向性確認用で、最終UIはReact/CSSの動的コンポーネントとして反映します。
        </p>
      </section>
    </main>
  )
}
