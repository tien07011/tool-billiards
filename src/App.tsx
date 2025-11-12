import './App.css'
import BilliardsAim from './BilliardsAim'

function App() {
  return (
    <>
      <h1>Tool Ngắm Góc Bida</h1>
      <p style={{ maxWidth: 760, margin: '0 auto 1rem', fontSize: 14 }}>
        Kéo bi trắng, bi đỏ hoặc chọn lỗ để xem góc cắt. Chuyển chế độ qua chọn "Một băng" để tập đường băng phản xạ.
      </p>
      <BilliardsAim />
    </>
  )
}

export default App
