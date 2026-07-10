import LpFeaturePage from './components/LpFeaturePage'

export default function LpPerformance() {
  return (
    <LpFeaturePage
      eyebrow="Webサイト成果レポート"
      icon="monitoring"
      title="Webサイトの数字を、"
      highlight="読めるレポートへ。"
      description="アクセス、来訪元、ページ、成果を、取得状態と期間が分かるグラフに整理します。基本レポートと根拠整理にはAIキーが要りません。"
      image="/imagegen/calm-analytics-desk.webp"
      imageAlt="グラフを確認できる落ち着いた作業机"
      primaryLabel="分析の準備を始める"
      primaryTo="/ads/wizard"
      cards={[
        { icon: 'summarize', title: '初心者向けの要約', body: '最初に見る数字、判断を保留する項目、次に確認することを順番に表示します。' },
        { icon: 'monitoring', title: '根拠が見えるグラフ', body: '対象期間と指標を明示し、取得できなかったデータを推測で補いません。' },
        { icon: 'key_off', title: 'AIキーなしで開始', body: '決められたルールによる根拠整理を使い、必要な場合だけ詳細AI分析へ進みます。' },
      ]}
      steps={[
        { title: '接続状態を確認', body: 'GA4からBigQueryへのエクスポートと、対象データへの権限を確認します。' },
        { title: '期間と項目を選択', body: '直近28日など、比較しやすい期間と見る項目を選びます。' },
        { title: 'まとめから読む', body: '要約、グラフ、次の確認項目の順で判断を進めます。' },
      ]}
      noteTitle="実データにはGoogle側の設定が必要です"
      note="Webサイトの実データを表示するには、GA4・BigQueryの接続と権限設定が必要です。AIキーだけでは実データを取得できません。"
    />
  )
}
