# nunnuncode

[🇬🇧 English](README.md) · [🇻🇳 Tiếng Việt](README_VI.md) · [🇩🇪 Deutsch](README_DE.md)

> **Một agent nhỏ có thể tự phát triển một cách an toàn.**

Nunnuncode là thử nghiệm xây dựng một personal agent tối giản cho người dùng không có kiến thức kỹ thuật: agent có thể tự mở rộng khả năng của mình nhưng vẫn dễ hiểu, bị giới hạn bởi quyền, được kiểm thử và luôn có thể quay lại trạng thái trước.

Dự án bắt đầu từ một coding agent rất nhỏ dựa trên [nanocode](https://github.com/1rgs/nanocode). Implementation hiện tại vẫn là phần nền nhỏ đó. Mục tiêu dài hạn không phải xây thêm một agent framework khổng lồ, mà tìm ra kiến trúc sạch và nhỏ nhất có thể hỗ trợ self-evolution an toàn.

![screenshot](screenshot.png)

## Trạng thái hiện tại

Hiện tại Nunnuncode là một coding-agent harness nhỏ với:

- agent loop LLM + tools + history
- tools: `read`, `write`, `edit`, `glob`, `grep`, `bash`
- hỗ trợ Anthropic, OpenRouter và OpenAI-compatible providers
- reasoning/thinking
- xử lý cơ bản khi context overflow
- end-to-end tests

Đây mới là các primitive. Safe self-evolution là roadmap tiếp theo.

## Nguyên tắc thiết kế

### 1. Minimal, nhưng không cố ép phải cực nhỏ

Code nhỏ có giá trị vì một người phải có thể ngồi đọc và hiểu project tương đối nhanh. Nhưng single-file và zero-dependency không phải mục tiêu tự thân.

Dependency được phép dùng nếu nó thực sự giảm độ phức tạp hoặc tăng độ an toàn. Mỗi dependency và abstraction phải chứng minh được lý do tồn tại.

### 2. Agent được thay đổi implementation, không được thay đổi governance

Agent có thể tạo hoặc sửa capability, workflow, prompt và learned behavior.

Agent không được tự làm yếu các luật kiểm soát chính nó: permission checks, yêu cầu test, rollback, audit history hay protected kernel boundary.

### 3. Evolution là một transaction

Self-modification không được là "sửa code đang chạy rồi hy vọng mọi thứ ổn".

Flow mục tiêu:

```text
phát hiện thiếu capability
        ↓
đề xuất nhỏ nhất
        ↓
candidate tách biệt
        ↓
policy + permission checks
        ↓
tests + behavioral evaluation
        ↓
human approval khi cần
        ↓
promote
        ↓
observe
        ↓
rollback nếu regression
```

### 4. Con người kiểm soát intent và permission

Nunnuncode hướng tới non-tech user. Người dùng không nên phải đọc Python diff.

Với thay đổi có rủi ro, agent cần giải thích bằng ngôn ngữ bình thường:

- muốn thêm hoặc thay đổi capability nào
- tại sao cần nó
- cần những quyền gì
- có thể tác động tới dữ liệu/hệ thống nào
- thay đổi có rollback được không
- validation đã pass chưa

Con người kiểm soát intent, permission và hậu quả khó đảo ngược. Hệ thống chịu trách nhiệm kiểm soát implementation safety.

### 5. Complexity là một chi phí

Một thay đổi chạy được chưa có nghĩa là thay đổi tốt.

Agent nên ưu tiên:

```text
reuse → compose → simplify → refactor → add code
```

Agent phải biết xóa và hợp nhất capability, không chỉ liên tục thêm mới. Duplicate abstraction, dead code, dependency không cần thiết và architecture cho nhu cầu giả định đều được xem là regression.

### 6. Mọi evolution phải dễ hiểu và reversible

Mỗi evolution được chấp nhận cần để lại audit trail:

- đã thay đổi gì
- tại sao thay đổi
- cần permission nào
- đã chạy test/evaluation nào
- kết quả
- version trước / đường rollback

## Kiến trúc mục tiêu

Cấu trúc cụ thể có thể tiếp tục thay đổi, nhưng boundary dự kiến rất đơn giản:

```text
Kernel
  ├─ agent loop
  ├─ permissions
  ├─ capability loading
  ├─ evolution policy
  └─ rollback / audit
        ↓ governs
Agent
  ├─ memory
  ├─ workflows
  └─ behavior
        ↓ uses / evolves
Capabilities
```

**Kernel nhỏ và do con người duy trì.** Agent có thể evolve capabilities nhưng không được tự cấp quyền mới hoặc sửa các luật dùng để kiểm soát evolution.

## Roadmap

Roadmap chi tiết nằm trong [Epic #1](https://github.com/Hoangkim1301/nunnuncode/issues/1).

### Foundation — safety trước autonomy

- protected kernel và evolvable code
- permission model và safe defaults
- shell/filesystem boundaries
- execution budgets
- API reliability

### Stage 1 — dùng được cho non-tech user

- persistent memory có provenance
- output bằng ngôn ngữ dễ hiểu
- approval flow dễ hiểu cho người không biết code

### Stage 2 — capabilities

- dynamic capability registry
- capability module có metadata, permissions và dependencies rõ ràng
- ưu tiên reuse/composition trước khi sinh code capability mới

### Stage 3 — guarded evolution

- candidate change tách biệt
- tests + behavioral evaluation
- chỉ promote sau khi validation pass
- automatic rollback
- version/evolution history
- simplification và cleanup là evolution operation chính thức

## Cách sử dụng

### Anthropic

```bash
export ANTHROPIC_API_KEY="your-key"
python nanocode.py
```

### OpenRouter

```bash
export OPENROUTER_API_KEY="your-key"
python nanocode.py
```

Để dùng model khác:

```bash
export OPENROUTER_API_KEY="your-key"
export MODEL="openai/gpt-5.2"
python nanocode.py
```

### OpenAI-compatible provider tùy ý

```bash
export API_BASE_URL="https://your-provider.example/v1"
export API_KEY="your-key"
export MODEL="your-model-name"
python nanocode.py
```

### Chạy test

```bash
python -m unittest discover tests
```

## Lệnh

| Lệnh | Mô tả |
|------|------|
| `/c` | Xóa hội thoại |
| `/q` hoặc `exit` | Thoát |

## Lời cảm ơn

Ban đầu dựa trên [nanocode](https://github.com/1rgs/nanocode) của [1rgs](https://github.com/1rgs).

## Giấy phép

MIT
