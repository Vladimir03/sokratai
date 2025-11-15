# Sokratai Codebase Overview

## Project Summary
**Sokratai** is an AI-powered educational platform for Russian school students preparing for the Unified State Exam (ЕГЭ). It features:
- Interactive chat with AI tutoring
- Homework management and AI analysis
- Problem solving practice
- Progress tracking
- Telegram Mini App integration
- Mobile-first responsive design

**Technology Stack:**
- Frontend: React 18.3 + TypeScript + Vite
- State Management: TanStack React Query (React Query)
- Backend: Supabase (PostgreSQL + Auth)
- UI Library: shadcn-ui components + Radix UI
- Styling: Tailwind CSS with custom CSS variables
- Additional: Framer Motion, React Markdown with KaTeX, React Virtual for virtualization

---

## 1. Directory Structure

```
/home/user/sokratai/
├── src/
│   ├── components/              # React components
│   │   ├── ui/                  # shadcn-ui components (48+ files)
│   │   ├── sections/            # Landing page sections (15 components)
│   │   ├── miniapp/             # Telegram Mini App components (6 files)
│   │   ├── Chat*.tsx            # Chat-related components
│   │   ├── Navigation.tsx        # Main navigation bar
│   │   ├── AuthGuard.tsx         # Authentication wrapper
│   │   └── [other components]
│   ├── pages/                   # Page-level components (14 pages)
│   │   ├── Chat.tsx             # Main chat interface (62KB)
│   │   ├── Homework.tsx         # Homework management
│   │   ├── HomeworkAdd.tsx      # Add homework
│   │   ├── HomeworkTaskList.tsx # View homework tasks
│   │   ├── HomeworkTaskDetail.tsx
│   │   ├── Problems.tsx         # Problem practice
│   │   ├── Progress.tsx         # User progress tracking
│   │   ├── Profile.tsx          # User profile
│   │   ├── Index.tsx            # Landing page
│   │   ├── Login.tsx            # Authentication
│   │   ├── SignUp.tsx           # Registration
│   │   ├── MiniApp.tsx          # Telegram Mini App
│   │   ├── MiniAppSolution.tsx  # Mini App solution viewer
│   │   └── NotFound.tsx         # 404 page
│   ├── hooks/                   # Custom React hooks (4 files)
│   ├── types/                   # TypeScript type definitions (2 files)
│   │   ├── homework.ts          # Homework-related types
│   │   └── solution.ts          # Solution types and Telegram types
│   ├── utils/                   # Utility functions (9 files)
│   ├── lib/                     # Library helpers
│   ├── integrations/            # Backend integrations
│   │   └── supabase/            # Supabase client and types
│   ├── assets/                  # Static assets
│   ├── index.css                # Global styles with design tokens
│   ├── main.tsx                 # React entry point
│   ├── App.tsx                  # Route configuration
│   └── registerServiceWorker.ts # Service worker setup
├── supabase/                    # Supabase database migrations (20+ migrations)
├── public/                      # Static files served publicly
├── vite.config.ts               # Vite bundler configuration
├── tailwind.config.ts           # Tailwind CSS configuration
├── tsconfig.app.json            # TypeScript config
├── components.json              # shadcn-ui configuration
├── index.html                   # HTML entry point with performance optimizations
├── package.json                 # Dependencies and scripts
├── .env                         # Environment variables
└── README.md                    # Project documentation
```

---

## 2. Key Components

### Core Layout Components

#### **Navigation** (`/src/components/Navigation.tsx`)
- Fixed top navigation bar with logo
- Desktop: Horizontal menu with route buttons
- Mobile: Horizontal scrollable navigation tabs
- Logout functionality
- Active route highlighting

#### **AuthGuard** (`/src/components/AuthGuard.tsx`)
- Wraps protected routes
- Checks authentication state via Supabase
- Redirects to login if not authenticated
- Shows loading indicator during auth check
- Includes Navigation component

#### **PageContent** (`/src/components/PageContent.tsx`)
- Simple content wrapper with padding adjustments

### Chat-Related Components

#### **Chat.tsx** (62KB - Main chat page)
**Key Features:**
- Virtual scrolling with `@tanstack/react-virtual` for performance (50+ messages)
- Message virtualization with dynamic size estimation
- Image upload and preview support
- File handling with blob URL management
- Real-time message updates via React Query
- Chat sidebar with conversation history
- Optimistic message updates with status tracking
- Message caching (session + localStorage)
- Haptic feedback integration
- Touch gesture detection (swipe)
- Auto-scroll to latest messages
- Draft message persistence
- Network connection indicator
- Device-specific optimizations (iOS, Android)

**Key Interfaces:**
```typescript
interface Message {
  role: "user" | "assistant";
  content: string;
  image_url?: string;
  image_path?: string;
  id?: string;
  feedback?: 'like' | 'dislike' | null;
  input_method?: 'text' | 'voice' | 'button';
  status?: 'sending' | 'sent' | 'ai_thinking' | 'delivered' | 'failed';
}
```

#### **ChatMessage.tsx**
- Lazy-loaded ReactMarkdown for rendering
- KaTeX support for mathematical formulas
- Copy-to-clipboard functionality
- Feedback system (like/dislike)
- Message status indicators
- Image modal view
- Action buttons (retry, share)
- Memoized markdown components for performance

#### **ChatInput.tsx**
- Auto-expanding textarea
- iOS keyboard handling
- File upload (image gallery and camera)
- File preview with removal option
- Message input with external value sync
- Input method tracking
- Haptic feedback on send

#### **ChatSidebar.tsx**
- Lists all user chats (general, task-based, custom)
- Lazy loading with fallback
- Create new chat dialog
- Archive chat functionality
- Optimistic UI for new chats
- Last message timestamps
- Chat type indicators (emoji icons)

#### **CreateChatDialog.tsx**
- Custom chat creation modal
- Emoji icon picker
- Optimistic chat creation
- Invalidates chat query on completion
- iOS focus management fix

### Homework Components

#### **Homework.tsx**
- Displays homework sets grouped by priority
- Filtering by subject and deadline
- Task count display
- Priority badges with colors
- Quick action to add homework
- Status indicators for incomplete conditions

#### **HomeworkAdd.tsx**
- Form to create new homework set
- Subject selection (dropdown)
- Topic input
- Deadline picker
- Priority selection (urgent, important, later)
- Task numbers input (comma-separated)
- Automatic task creation

#### **HomeworkTaskList.tsx**
- Shows all tasks in a homework set
- Task status management
- Condition text/photo upload
- Edit task dialog
- Task deletion
- AI analysis display

#### **HomeworkTaskDetail.tsx**
- Full task details view
- Chat interface for task-specific discussions
- Condition photo display
- AI analysis hints and solution steps
- Status update controls

### Section Components (Landing Page)
Located in `/src/components/sections/`:
1. **SpecialOffer** - Banner with promotional message
2. **ValueProposition** - Key benefits
3. **AhaMoments** - Use case scenarios
4. **Problems** - Student problems addressed
5. **Empathy** - Emotional connection
6. **HowItWorks** - Step-by-step explanation
7. **Results** - Student outcomes
8. **Testimonials** - User reviews
9. **Comparison** - vs competitors
10. **Pricing** - Subscription plans
11. **FAQ** - Frequently asked questions
12. **ForParents** - Parent-specific section
13. **Footer** - Footer links
14. **BenefitsSection**, **FeaturesSection** - Additional info

### Mini App Components
Located in `/src/components/miniapp/`:
- **MiniAppLayout.tsx** - Telegram theme integration wrapper
- **SolutionView.tsx** - Solution display with step navigation
- **StepCard.tsx** - Individual solution step component
- **MathBlock.tsx** - Math formula rendering (KaTeX)
- **Math.tsx** - Inline math support
- **BackButton.tsx** - Telegram back navigation

### UI Components (shadcn-ui)
48 pre-built Radix UI components including:
- Dialog, Drawer, Sheet (modals)
- Button, Input, Textarea (forms)
- Card, Badge, Alert (display)
- Tabs, Accordion, Collapsible (navigation)
- Select, Checkbox, Radio, Switch (inputs)
- Tooltip, Popover, HoverCard (feedback)
- Toast notifications
- And more...

---

## 3. Routing Structure

**Router Setup:** React Router DOM v6 with lazy loading and Suspense

**Routes:**

| Path | Component | Auth Required | Purpose |
|------|-----------|---------------|---------|
| `/` | Index | No | Landing page with sign-up CTAs |
| `/login` | Login | No | Authentication |
| `/signup` | SignUp | No | User registration |
| `/chat` | Chat | Yes | Main AI chat interface |
| `/chat?id=<chatId>` | Chat | Yes | Specific chat view |
| `/homework` | Homework | Yes | Homework list and management |
| `/homework/add` | HomeworkAdd | Yes | Create new homework |
| `/homework/:id` | HomeworkTaskList | Yes | View homework tasks |
| `/homework/:homeworkId/task/:taskId` | HomeworkTaskDetail | Yes | Task details + chat |
| `/problems` | Problems | Yes | Practice problem solving |
| `/progress` | Progress | Yes | View user statistics |
| `/profile` | Profile | Yes | User profile and settings |
| `/miniapp` | MiniApp | No | Telegram Mini App entry |
| `/miniapp/solution/:id` | MiniAppSolution | No | View solution in Mini App |
| `*` | NotFound | N/A | 404 page |

**Lazy Loading Pattern:**
```typescript
const Chat = lazy(() => import("./pages/Chat"));
const PageLoader = () => <LoadingSpinner />;

<Suspense fallback={<PageLoader />}>
  <Chat />
</Suspense>
```

---

## 4. State Management

**Primary Pattern:** TanStack React Query (React Query)

### Query Keys Structure

**User Authentication:**
```typescript
queryKey: ['user'] // Current authenticated user
```

**Chat Operations:**
```typescript
queryKey: ['chats', user?.id]      // All user chats
queryKey: ['general-chat', user?.id] // Default general chat
queryKey: ['chat-messages', chatId] // Messages for specific chat
```

**Homework:**
```typescript
queryKey: ["homework-sets"]        // All homework
queryKey: ["homework-task", id]    // Specific homework task
```

**Problems:**
```typescript
queryKey: ["problems"]             // All problems
queryKey: ["user-solutions"]       // User's problem solutions
```

**Patterns:**
- Auto-refetch on window focus (default)
- Stale time: varies by query (usually 5 minutes)
- Garbage collection: 5 minutes
- Error handling with toast notifications
- Optimistic updates for mutations
- Manual invalidation after mutations

### Local State Management

**Chat.tsx:**
```typescript
const [messages, setMessages] = useState<Message[]>([])
const [isLoading, setIsLoading] = useState(false)
const [uploadedFile, setUploadedFile] = useState<File | null>(null)
const [isSidebarOpen, setIsSidebarOpen] = useState(false)
// ... and more for UI state
```

**Message Status Tracking:**
- `sending`: User message being sent
- `sent`: Message reached server
- `ai_thinking`: AI processing
- `delivered`: Complete response received
- `failed`: Error occurred

### Caching Strategy

**Session Cache** (`/src/utils/chatCache.ts`):
- 50 message limit per chat
- 30-minute TTL
- Falls back to localStorage
- User ID validation
- Prevents stale data from other users

---

## 5. API/Backend Integration

### Supabase Client

**Location:** `/src/integrations/supabase/client.ts`

```typescript
export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);
```

### Database Tables

**Authentication:**
- `auth.users` - Built-in Supabase auth

**Core Tables:**
- `profiles` - User profile data (username, etc.)
- `user_stats` - XP, level, streak tracking
- `chats` - Chat conversations
- `chat_messages` - Individual messages
- `homework_sets` - Homework collections
- `homework_tasks` - Individual tasks
- `problems_public` - Public problem set (view)
- `user_solutions` - User problem solutions
- `answer_attempts` - Problem answer history
- `solutions` - Telegram Mini App solutions
- `api_rate_limits` - Rate limiting tracking

### Key Supabase Operations

**Authentication:**
```typescript
supabase.auth.signInWithPassword({ email, password })
supabase.auth.signUp({ email, password })
supabase.auth.signOut()
supabase.auth.getUser()
supabase.auth.getSession()
supabase.auth.onAuthStateChange() // Real-time listener
```

**Database Queries:**
```typescript
supabase.from('chats').select('*').eq('user_id', userId)
supabase.from('chat_messages').insert({ ... })
supabase.from('homework_sets').select(`*, homework_tasks(*)`)
```

**Remote Procedures:**
```typescript
supabase.rpc('check_problem_answer', {
  problem_id_input: problemId,
  user_answer_input: answer
})
```

### File Storage

**Image uploads:**
- Chat message images → storage bucket
- Homework condition photos → storage bucket
- Path persisted in database
- Public/private access control via RLS

### Real-Time Subscriptions

**Potential usage (not fully implemented):**
```typescript
supabase
  .channel('chat_updates')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, (payload) => {
    // Handle new messages
  })
  .subscribe()
```

---

## 6. Styling Approach

### Design System (`/src/index.css`)

**Color Palette (HSL format):**
```css
Light Mode:
--primary: 231 36% 29%           /* Indigo */
--primary-foreground: 0 0% 100%  /* White */
--primary-glow: 142 76% 36%      /* Green accent */
--accent: 142 76% 36%            /* Green */
--background: 0 0% 100%          /* White */
--foreground: 220 15% 11%        /* Dark blue-gray */
--card: 0 0% 100%                /* White */
--border: 214.3 31.8% 91.4%     /* Light gray */
--destructive: 0 84.2% 60.2%    /* Red */

Dark Mode:
--background: 220 15% 11%        /* Dark blue-gray */
--foreground: 210 40% 98%        /* Off-white */
--card: 220 20% 14%              /* Dark card */
--primary: 231 36% 29%           /* Same indigo */
```

**Custom Gradients:**
```css
--gradient-hero: linear-gradient(135deg, hsl(231, 36%, 29%) 0%, hsl(231, 34%, 39%) 50%, hsl(231, 32%, 49%) 100%)
--gradient-accent: linear-gradient(135deg, hsl(142, 76%, 36%) 0%, hsl(142, 84%, 25%) 100%)
```

**Shadows:**
```css
--shadow-elegant: 0 4px 20px hsla(231, 36%, 29%, 0.08)
--shadow-glow: 0 10px 30px hsla(142, 76%, 36%, 0.3)
```

### Tailwind Configuration

**Key Settings:**
- Content paths: `./src/**/*.{ts,tsx}`
- Prefix: none (default)
- Dark mode: class-based (`dark` class)
- Container: centered, 2rem padding, max 1400px

**Extended Theme:**
- Custom colors using CSS variables
- Sidebar color system (background, primary, accent, border)
- Border radius: `var(--radius)` (1rem) with variants
- Animations: `accordion-down`, `accordion-up`

### Component Styling Pattern

**shadcn-ui Components:**
```typescript
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

// Use with Tailwind classes
<Button className="gap-2" variant="default" size="lg">
  Click me
</Button>
```

**Custom Classes:**
```tsx
<div className="p-4 rounded-lg bg-card shadow-elegant border border-border">
  Content
</div>
```

### Dynamic Styling

**Tailwind Merge:**
```typescript
import { cn } from "@/lib/utils"

// Merges and deduplicates Tailwind classes
<div className={cn("p-4", isActive && "bg-primary text-white")}>
  Content
</div>
```

**CSS Variables for Theme:**
```tsx
// Telegram Mini App theme integration
style={{ 
  backgroundColor: 'var(--tg-theme-bg-color, hsl(var(--card)))',
  color: 'var(--tg-theme-text-color, hsl(var(--foreground)))'
}}
```

### Animation Framework

**Framer Motion:**
```typescript
import { motion, AnimatePresence } from "framer-motion"

<AnimatePresence>
  {isVisible && (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
    >
      Content
    </motion.div>
  )}
</AnimatePresence>
```

**CSS Animations:**
- Fade-in-up: defined in index.css
- Tailwind built-in: bounce, spin, pulse, etc.

### Responsive Design

**Breakpoints (Tailwind defaults):**
- Mobile: default
- `md`: 768px (tablet)
- `lg`: 1024px
- `xl`: 1280px
- `2xl`: 1536px

**Mobile-first approach:**
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
  {/* 1 col on mobile, 2 on tablet, 3 on desktop */}
</div>
```

---

## 7. Type Definitions

### Homework Types (`/src/types/homework.ts`)

```typescript
type Priority = 'urgent' | 'important' | 'later'
type TaskStatus = 'not_started' | 'in_progress' | 'completed'

interface HomeworkSet {
  id: string
  user_id: string
  subject: string
  topic: string
  photo_url?: string
  deadline?: string
  priority: Priority
  created_at: string
  updated_at: string
  tasks?: HomeworkTask[]
}

interface HomeworkTask {
  id: string
  homework_set_id: string
  task_number: string
  condition_text?: string
  condition_photo_url?: string
  ai_analysis?: {
    difficulty: string
    type: string
    hints: string[]
    solution_steps: string[]
  }
  status: TaskStatus
  created_at: string
  updated_at: string
}

interface HomeworkChatMessage {
  id: string
  homework_task_id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

// Constants
const SUBJECTS = [
  { id: 'geometry', name: 'Геометрия', emoji: '📐' },
  { id: 'algebra', name: 'Алгебра', emoji: '📈' },
  // ...
]

const PRIORITY_CONFIG = {
  urgent: { label: 'Срочно', color: 'red', emoji: '🔴' },
  important: { label: 'Важно', color: 'yellow', emoji: '🟡' },
  later: { label: 'Позже', color: 'green', emoji: '🟢' }
}
```

### Solution Types (`/src/types/solution.ts`)

```typescript
interface SolutionStep {
  number: number
  title: string
  content: string
  formula?: string
  method?: string
}

interface Solution {
  id: string
  problem: string
  steps: SolutionStep[]
  finalAnswer: string
  subject?: string
  difficulty?: 'easy' | 'medium' | 'hard'
  createdAt?: string
}

// Telegram Mini App types
interface TelegramWebApp {
  ready: () => void
  expand: () => void
  close: () => void
  BackButton: {
    show: () => void
    hide: () => void
    onClick: (callback: () => void) => void
    offClick: (callback: () => void) => void
  }
  themeParams: {
    bg_color?: string
    text_color?: string
    // ...
  }
  colorScheme: 'light' | 'dark'
  initDataUnsafe: {
    user?: {
      id: number
      first_name: string
      last_name?: string
      username?: string
    }
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp }
  }
}
```

### Supabase Generated Types

**Location:** `/src/integrations/supabase/types.ts`

Auto-generated TypeScript definitions from database schema:
- `Database` interface with all tables
- `Tables<T>` for row data
- `TablesInsert<T>` for insert operations
- `TablesUpdate<T>` for update operations
- `Enums` for enum types
- Full type safety for database operations

---

## 8. Configuration Files

### Vite Config (`vite.config.ts`)

**Key Features:**
- React SWC plugin for faster builds
- Path alias: `@` → `src/`
- Async CSS plugin for non-render-blocking stylesheets
- Development server: port 8080, all interfaces

**Build Optimization:**
```typescript
manualChunks: {
  'react-vendor': ['react', 'react-dom', 'react-router-dom'],
  'ui-components': ['@radix-ui/react-dialog', ...],
  'supabase': ['@supabase/supabase-js'],
  'math-rendering': ['katex', 'react-katex', 'react-markdown']
}
```

**Minification:** esbuild (faster than Terser)
**Chunk size warning limit:** 600 KB

### TypeScript Config (`tsconfig.app.json`)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "strict": false,  // Lenient mode for faster development
    "noUnusedLocals": false,
    "noUnusedParameters": false
  }
}
```

### Tailwind Config (`tailwind.config.ts`)

```typescript
export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT, foreground, glow },
        accent, secondary, destructive, // All HSL-based
        sidebar: { background, foreground, primary, ... }
      },
      backgroundImage: {
        'gradient-hero': 'var(--gradient-hero)',
        'gradient-card': 'var(--gradient-card)'
      },
      boxShadow: {
        'elegant': 'var(--shadow-elegant)',
        'glow': 'var(--shadow-glow)'
      }
    }
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography")
  ]
}
```

### Components Config (`components.json`)

```json
{
  "style": "default",
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate"
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "hooks": "@/hooks"
  }
}
```

### Environment Variables (`.env`)

```
VITE_SUPABASE_PROJECT_ID=vrsseotrfmsxpbciyqzc
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGc...
VITE_SUPABASE_URL=https://vrsseotrfmsxpbciyqzc.supabase.co
```

All prefixed with `VITE_` to be exposed to client.

### Package Scripts

```json
{
  "dev": "vite",
  "build": "vite build",
  "build:dev": "vite build --mode development",
  "lint": "eslint .",
  "preview": "vite preview"
}
```

---

## 9. Key Features

### 1. AI Chat Interface
- **Real-time conversation** with AI tutor
- **Image support** for math problems
- **LaTeX formula rendering** for clear mathematics display
- **Message virtualization** for performance (50+ messages)
- **Status tracking**: sending, sent, ai_thinking, delivered, failed
- **Feedback system**: like/dislike responses
- **Copy to clipboard** for answers
- **Multiple chat types**: general, homework task-specific, custom

### 2. Homework Management
- **Create homework sets** with multiple tasks
- **Photo upload** for homework conditions
- **AI analysis** with hints and solution steps
- **Task status tracking**: not_started, in_progress, completed
- **Priority system**: urgent, important, later
- **Deadline tracking** with date-fns formatting (Russian locale)
- **Embedded chat** for task-specific discussions

### 3. Problem Practice
- **Problem database** with filtering (topic, difficulty)
- **Answer submission** with automated checking
- **KaTeX support** for mathematical expressions
- **Solution history** tracking
- **Category statistics** by topic
- **Accuracy metrics**

### 4. Progress Tracking
- **XP/Level system** (user_stats table)
- **Streak tracking** (daily activity)
- **Category breakdown** by subject
- **Accuracy percentage** calculation
- **Total problems solved** counter

### 5. User Profiles
- **Username management** with validation
- **Statistics display**
- **Profile editing**
- **XP and level display**
- **Streak information**

### 6. Telegram Mini App
- **Standalone solution viewer** for Telegram
- **Theme integration** with Telegram colors
- **Back button** functionality
- **Step-by-step solutions** with KaTeX math
- **Separate database table** for Mini App solutions

### 7. Mobile Optimization
- **Touch gesture detection** (swipe)
- **iOS keyboard handling**
- **Safe area adjustments**
- **Haptic feedback** (vibration API)
- **Bottom navigation** on mobile
- **Responsive images**
- **Reduced animations** on virtualized content

### 8. Performance Features
- **Code splitting** with lazy loading (14 lazy pages)
- **Virtual scrolling** for chat (50+ messages)
- **Message caching** (session + localStorage)
- **Service Worker** for offline support
- **Non-render-blocking CSS**
- **Optimized imports** for math libraries
- **Dynamic size estimation** for messages
- **Debounced scroll handling**

### 9. Real-time Features
- **Auth state synchronization**
- **Chat sidebar auto-update**
- **Message status updates**
- **React Query stale-while-revalidate**
- **Optimistic UI updates**
- **Error recovery with retry logic**

### 10. Accessibility & UX
- **Toast notifications** (sonner)
- **Loading skeletons** (ChatSkeleton)
- **Connection indicator** (online/offline status)
- **Form validation** with Zod schemas
- **Keyboard navigation** support
- **Dark mode** support

---

## 10. Code Conventions & Patterns

### Naming Conventions

**Files:**
- Components: `PascalCase` (e.g., `ChatMessage.tsx`, `Navigation.tsx`)
- Pages: `PascalCase` (e.g., `Chat.tsx`, `Homework.tsx`)
- Utilities: `camelCase` (e.g., `chatCache.ts`, `haptics.ts`)
- Hooks: `camelCase` with `use` prefix (e.g., `use-mobile.tsx`)
- Types: `camelCase` file names but `PascalCase` interface names

**Variables:**
- State: `camelCase` (e.g., `isLoading`, `chatId`)
- Types: `PascalCase` (e.g., `Message`, `HomeworkSet`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_CACHED_MESSAGES`, `CACHE_TTL`)

### Component Patterns

**Functional Components with Hooks:**
```typescript
import { useState, useEffect } from 'react'

export default function ChatMessage() {
  const [state, setState] = useState<Type>(initialValue)
  
  useEffect(() => {
    // side effects
  }, [dependencies])
  
  return <div>JSX</div>
}
```

**Memoization for Performance:**
```typescript
import { memo, useMemo, useCallback } from 'react'

const Component = memo(({ prop }: Props) => {
  const memoValue = useMemo(() => expensiveCalc(), [dep])
  const memoFunction = useCallback(() => {}, [dep])
  
  return <div>{memoValue}</div>
})
```

**Lazy Loading:**
```typescript
import { lazy, Suspense } from 'react'

const HeavyComponent = lazy(() => import('./HeavyComponent'))

<Suspense fallback={<Loading />}>
  <HeavyComponent />
</Suspense>
```

### Data Fetching Patterns

**React Query for server state:**
```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['resource', id],
  queryFn: async () => {
    const { data, error } = await supabase.from('table').select()
    if (error) throw error
    return data
  },
  staleTime: 5 * 60 * 1000  // 5 minutes
})
```

**Optimistic Updates:**
```typescript
const queryClient = useQueryClient()

const mutation = useMutation({
  mutationFn: async (newData) => {
    // Optimistic update
    queryClient.setQueryData(['key'], old => [...old, newData])
    // Actual mutation
    return await api.post(newData)
  },
  onError: () => {
    // Revert on error
    queryClient.invalidateQueries({ queryKey: ['key'] })
  }
})
```

### Error Handling

**Toast notifications:**
```typescript
import { toast } from 'sonner'

try {
  // operation
} catch (error: any) {
  toast.error(error.message || 'Error occurred')
}
```

**Form validation with Zod:**
```typescript
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
})

const validation = schema.safeParse(data)
if (!validation.success) {
  toast.error(validation.error.errors[0].message)
}
```

### Import Organization

```typescript
// 1. React and external libraries
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'

// 2. Internal utilities and hooks
import { supabase } from '@/integrations/supabase/client'
import { useIsMobile } from '@/hooks/use-mobile'

// 3. Components
import { Button } from '@/components/ui/button'
import Navigation from '@/components/Navigation'

// 4. Types
import type { Message } from '@/types/homework'

// 5. Utilities
import { cn } from '@/lib/utils'
```

### Component Structure Pattern

```typescript
// 1. Imports
// 2. Type definitions (interfaces, types)
// 3. Constants
// 4. Helper functions
// 5. Main component function
// 6. Hooks logic (useState, useQuery, etc.)
// 7. Event handlers
// 8. Rendered JSX
// 9. Export
```

### CSS Class Patterns

```typescript
// Use cn() to merge Tailwind classes
<div className={cn(
  "base-classes",
  isActive && "active-classes",
  variant === 'primary' && "primary-classes"
)}>
```

### Ref and Side Effect Patterns

```typescript
// Cleanup refs properly
const blobUrlsRef = useRef<Set<string>>(new Set())

useEffect(() => {
  return () => {
    // Cleanup
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
  }
}, [])
```

### Device Detection

```typescript
import { useIsMobile, useDeviceType, isAndroid } from '@/hooks/use-mobile'

const isMobile = useIsMobile()
const deviceType = useDeviceType() // 'ios' | 'android' | 'other'

if (isAndroid()) {
  // Android-specific code
}
```

### Haptic Feedback Integration

```typescript
import { haptics } from '@/utils/haptics'

haptics.button()       // Medium vibration
haptics.impact()       // Heavy vibration
haptics.success()      // Pattern: double tap
haptics.error()        // Pattern: triple tap
```

### Performance Monitoring

```typescript
import { PerformanceMonitor } from '@/utils/performanceMetrics'

PerformanceMonitor.startRequest()
PerformanceMonitor.recordFirstToken()  // First token received
PerformanceMonitor.endRequest()        // Request complete
PerformanceMonitor.recordDbSave()      // Database operations
```

### Message Caching

```typescript
import { saveChatToSessionCache, loadChatFromSessionCache } from '@/utils/chatCache'

// Save after receiving messages
saveChatToSessionCache(chatId, messages, userId)

// Load on mount
const cached = loadChatFromSessionCache(chatId, userId)

// Clear when needed
clearChatCache(chatId)
```

---

## Development Workflow

### Adding a New Page

1. Create file in `/src/pages/PageName.tsx`
2. Import components, hooks, types
3. Implement with AuthGuard if protected
4. Add lazy import in `App.tsx`
5. Add route to `App.tsx`
6. Use navigation to link to new page

### Adding a Component

1. Create file in `/src/components/` or subdirectory
2. Use TypeScript with proper interfaces
3. Export as named or default export
4. Import and use in pages or other components

### Adding API Integration

1. Use `supabase` client from `/src/integrations/supabase/client.ts`
2. Wrap in React Query hooks for data fetching
3. Use `useQuery` for reads, `useMutation` for writes
4. Handle errors with toast notifications

### Styling a Component

1. Use Tailwind classes from `tailwind.config.ts`
2. Reference CSS variables for colors/shadows
3. Use `cn()` utility for conditional classes
4. Follow mobile-first approach with responsive prefixes

---

## File Size Insights

**Largest Components:**
- Chat.tsx: 62 KB (main chat interface)
- Supabase types.ts: 24 KB (auto-generated)
- Various UI components: 1-5 KB each

**Total Components:** 84+ React components
**Total Pages:** 14 page routes
**UI Components (shadcn):** 48 pre-built components

---

## Database Schema (Key Tables)

Based on migrations, the schema includes:

- **auth.users** - Authentication (Supabase built-in)
- **profiles** - User profile data
- **chats** - Conversation metadata
- **chat_messages** - Individual messages with images
- **homework_sets** - Homework collections
- **homework_tasks** - Individual tasks
- **problems_public** - Public problem catalog (view)
- **user_solutions** - User answers to problems
- **answer_attempts** - Problem attempt history
- **solutions** - Telegram Mini App solutions
- **user_stats** - XP, level, streaks
- **api_rate_limits** - Rate limiting data

All tables have appropriate indexes and RLS policies.

---

## Performance Optimizations Implemented

1. **Code Splitting:** 14 lazy-loaded pages
2. **Virtual Scrolling:** @tanstack/react-virtual for chat
3. **Message Caching:** Session + localStorage
4. **CSS Optimization:** Non-render-blocking stylesheets
5. **Dynamic Imports:** Components loaded on demand
6. **Memoization:** Prevent unnecessary re-renders
7. **Debouncing:** Scroll and click handlers
8. **Compression:** Message optimization utilities
9. **Service Worker:** Offline support
10. **Optimized Chunks:** Separate vendor chunks for libraries

---

## Browser & Environment Requirements

- **Node.js:** 18+ (for development)
- **npm/bun:** Latest (for package management)
- **Browser Support:** Modern browsers with ES2020 support
- **Mobile:** iOS (Safari) and Android (Chrome) optimized
- **Offline:** Service Worker support

---

## Localization

**Current Language:** Russian (ru)
- Date formatting: `date-fns` with Russian locale (`ru`)
- UI text: All hardcoded in Russian
- Subject names, priority labels, messages: Russian

---

## Key Dependencies

- **react** & **react-dom**: 18.3
- **react-router-dom**: 6.30 (routing)
- **@tanstack/react-query**: 5.83 (server state)
- **@supabase/supabase-js**: 2.58 (backend)
- **tailwindcss**: 3.4 (styling)
- **framer-motion**: 12.23 (animations)
- **react-markdown**: 10.1 (markdown rendering)
- **katex** & **react-katex**: Math formulas
- **lucide-react**: Icons (450+)
- **sonner**: Toast notifications
- **zod**: Schema validation
- **recharts**: Data visualization
- **@tanstack/react-virtual**: Virtual scrolling

---

## AI Assistant Guidelines

### Working with this Codebase

When working on this project as an AI assistant, follow these guidelines:

#### 1. **Understanding Context First**
- Always read relevant files before making changes
- Check existing patterns and conventions in similar components
- Review the type definitions before implementing new features
- Look at the database schema when working with data

#### 2. **Code Quality Standards**
- **TypeScript**: Use proper typing, avoid `any` when possible
- **Components**: Keep components focused and single-responsibility
- **Performance**: Consider virtual scrolling, memoization, and lazy loading
- **Accessibility**: Ensure keyboard navigation and screen reader support
- **Mobile-first**: Test responsive behavior on all breakpoints

#### 3. **Common Pitfalls to Avoid**
- Don't bypass React Query for data fetching (use `useQuery`/`useMutation`)
- Don't forget to invalidate queries after mutations
- Don't hardcode colors/spacing (use Tailwind classes and CSS variables)
- Don't skip error handling (always use try-catch with toast notifications)
- Don't forget cleanup in useEffect hooks (blob URLs, event listeners, etc.)
- Don't break the mobile experience (test on small screens)

#### 4. **Testing Changes**
Before committing:
- Run `npm run lint` to check for linting errors
- Build with `npm run build` to catch TypeScript errors
- Test on mobile viewport (use browser dev tools)
- Verify authentication flow if touching auth-related code
- Check that lazy-loaded components still work

#### 5. **Database Changes**
When modifying database operations:
- Check `/src/integrations/supabase/types.ts` for table schemas
- Update types if schema changed
- Verify RLS policies won't block the operation
- Test with actual Supabase instance
- Consider migration impact on existing data

#### 6. **Performance Considerations**
- For chat features: consider message caching and virtual scrolling
- For new pages: implement lazy loading
- For heavy components: use React.memo or useMemo
- For images: ensure proper loading states and error handling
- Monitor bundle size after adding new dependencies

---

## Git Workflow & Development Process

### Branch Strategy

**Current Branch:** `claude/claude-md-mi0lm8b1v4i6lvyz-017Uc4Kw7GbpHMke17dpDCsq`

**Branch Naming Convention:**
- Feature branches: `feature/description` or `claude/session-id`
- Bug fixes: `fix/description`
- Date-based: `YYYY-MM-DD-description-issue-number`

**Workflow:**
1. All development happens on feature branches
2. Commit frequently with descriptive messages
3. Push to remote when ready
4. Create pull request for review
5. Merge to main after approval

### Commit Message Guidelines

**Format:**
```
<type>: <short description>

<optional detailed description>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `style`: Styling changes
- `perf`: Performance improvements
- `docs`: Documentation updates
- `chore`: Maintenance tasks

**Examples:**
```
feat: Add virtual scrolling to chat messages for better performance

fix: Resolve iOS keyboard overlap issue in chat input

refactor: Extract message caching logic into separate utility

perf: Implement lazy loading for landing page sections
```

### Development Commands

```bash
# Install dependencies
npm install

# Start development server (http://localhost:8080)
npm run dev

# Build for production
npm run build

# Build for development (with source maps)
npm run build:dev

# Run linter
npm run lint

# Preview production build
npm run preview
```

### ESLint Configuration

**Current Rules:**
- TypeScript recommended rules enabled
- React Hooks rules enforced
- React Refresh warnings for HMR compatibility
- `@typescript-eslint/no-unused-vars` disabled for faster development
- Ignores `dist/` directory

**Linting Philosophy:**
- Lenient mode for faster development
- Focus on catching critical errors
- Warnings for potential issues
- Auto-fixable rules preferred

---

## Common Development Tasks

### Adding a New Feature

**Step-by-step:**

1. **Plan the feature**
   - Identify required components
   - Check if database changes needed
   - Review existing similar features

2. **Database setup (if needed)**
   - Create migration in `supabase/migrations/`
   - Update types: check if Supabase auto-generates new types
   - Add RLS policies for security

3. **Create types**
   - Add interfaces to `/src/types/` if new domain
   - Use existing types where applicable

4. **Implement component**
   - Create component file in `/src/components/` or `/src/pages/`
   - Import necessary hooks and utilities
   - Use React Query for data fetching
   - Add proper TypeScript typing

5. **Add routing (if page)**
   - Update `App.tsx` with lazy import
   - Add route definition
   - Update navigation links

6. **Style the component**
   - Use Tailwind classes
   - Reference design tokens from CSS variables
   - Ensure responsive design (mobile-first)
   - Test dark mode compatibility

7. **Test thoroughly**
   - Test all user flows
   - Check mobile responsiveness
   - Verify error states
   - Test loading states

8. **Commit and push**
   - Write descriptive commit message
   - Push to feature branch
   - Create PR if ready

### Debugging Common Issues

#### **Issue: Authentication not working**
**Solutions:**
- Check `.env` file has correct Supabase credentials
- Verify user session with `supabase.auth.getSession()`
- Check RLS policies in Supabase dashboard
- Clear localStorage and retry

#### **Issue: Images not loading**
**Solutions:**
- Verify blob URLs are not revoked prematurely
- Check storage bucket permissions in Supabase
- Ensure proper CORS configuration
- Check file path is correct in database

#### **Issue: React Query not updating**
**Solutions:**
- Check if query key is correct
- Verify `invalidateQueries` is called after mutation
- Check stale time and cache time settings
- Look for errors in network tab

#### **Issue: Virtual scrolling glitches**
**Solutions:**
- Verify message size estimation function
- Check if `overscan` is appropriate
- Ensure messages have stable IDs
- Review scroll-to-bottom logic

#### **Issue: TypeScript errors**
**Solutions:**
- Check if Supabase types are up to date
- Verify imports use correct paths (@ alias)
- Ensure all required properties are provided
- Use `satisfies` or type assertions carefully

#### **Issue: Mobile layout broken**
**Solutions:**
- Check responsive classes (md:, lg:, etc.)
- Verify safe area insets for iOS
- Test with actual device or browser dev tools
- Check viewport meta tag in index.html

### Working with Supabase

**Common Operations:**

```typescript
// Fetch data
const { data, error } = await supabase
  .from('table_name')
  .select('*')
  .eq('column', value)

// Insert data
const { data, error } = await supabase
  .from('table_name')
  .insert({ column: value })
  .select()

// Update data
const { data, error } = await supabase
  .from('table_name')
  .update({ column: newValue })
  .eq('id', id)

// Delete data
const { data, error } = await supabase
  .from('table_name')
  .delete()
  .eq('id', id)

// Upload file
const { data, error } = await supabase.storage
  .from('bucket_name')
  .upload('path/filename', file)

// Call RPC function
const { data, error } = await supabase
  .rpc('function_name', { param: value })
```

**Best Practices:**
- Always check for errors: `if (error) throw error`
- Use `.select()` after insert/update to get returned data
- Use proper query filters to reduce data transfer
- Implement optimistic updates for better UX
- Cache query results with React Query

### Adding UI Components

**Using existing shadcn-ui components:**

```bash
# Components are already installed in /src/components/ui/
# Just import and use them:
```

```typescript
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog"
```

**Creating custom components:**

1. Create in `/src/components/ComponentName.tsx`
2. Follow existing patterns (functional components with hooks)
3. Export as default or named export
4. Document complex props with JSDoc comments

### Performance Optimization Tips

**When to optimize:**
- Chat messages exceed 50+ items → Use virtual scrolling
- Component re-renders unnecessarily → Use React.memo
- Expensive calculations → Use useMemo
- Callback functions → Use useCallback
- Large dependencies → Use code splitting
- Heavy images → Use lazy loading

**How to measure:**
- React DevTools Profiler
- Chrome Performance tab
- Lighthouse audit
- Check bundle size: `npm run build` shows chunk sizes

---

## Troubleshooting & FAQ

### Q: How do I add a new page?

**A:**
1. Create page component in `/src/pages/NewPage.tsx`
2. Add lazy import in `App.tsx`: `const NewPage = lazy(() => import("./pages/NewPage"))`
3. Add route: `<Route path="/new-page" element={<AuthGuard><NewPage /></AuthGuard>} />`
4. Add navigation link in `Navigation.tsx`

### Q: How do I modify the database schema?

**A:**
1. Create migration file in `supabase/migrations/`
2. Write SQL for schema changes
3. Run migration in Supabase dashboard or CLI
4. Regenerate types (Supabase auto-generates)
5. Update TypeScript interfaces if needed

### Q: How do I add a new Supabase table?

**A:**
1. Create migration with CREATE TABLE statement
2. Add RLS policies for security
3. Add indexes for performance
4. Update types in `/src/integrations/supabase/types.ts`
5. Create React Query hooks for the new table

### Q: How do I handle file uploads?

**A:**
1. Use `<input type="file" />` to get file
2. Upload to Supabase Storage:
   ```typescript
   const { data, error } = await supabase.storage
     .from('bucket_name')
     .upload(`path/${filename}`, file)
   ```
3. Store file path in database
4. Display using public URL or signed URL

### Q: How do I implement real-time features?

**A:**
1. Set up Supabase subscription:
   ```typescript
   const subscription = supabase
     .channel('changes')
     .on('postgres_changes', { event: '*', schema: 'public', table: 'table' }, callback)
     .subscribe()
   ```
2. Update local state when changes occur
3. Cleanup subscription on unmount

### Q: How do I add authentication to a new page?

**A:**
Wrap the route with `<AuthGuard>`:
```typescript
<Route path="/protected" element={<AuthGuard><ProtectedPage /></AuthGuard>} />
```

### Q: How do I add dark mode support to a component?

**A:**
Use Tailwind dark mode classes:
```typescript
<div className="bg-white dark:bg-gray-900 text-black dark:text-white">
  Content
</div>
```

### Q: How do I optimize a slow component?

**A:**
1. Use React DevTools Profiler to identify re-renders
2. Wrap with `React.memo` if props don't change often
3. Use `useMemo` for expensive calculations
4. Use `useCallback` for callback functions
5. Lazy load if component is heavy
6. Consider virtual scrolling for long lists

---

## Project-Specific Conventions

### Chat System Conventions

**Message Status Flow:**
```
User message: sending → sent
AI response: ai_thinking → delivered
Error: failed (with retry option)
```

**Message Caching:**
- Max 50 messages per chat in cache
- TTL: 30 minutes
- User validation to prevent cross-user data leak

**Image Handling:**
- Create blob URL for preview: `URL.createObjectURL(file)`
- Upload to Supabase Storage before sending message
- Store path in database, not URL
- Revoke blob URLs on cleanup

### Homework System Conventions

**Priority Levels:**
- `urgent`: Red badge, high priority
- `important`: Yellow badge, medium priority
- `later`: Green badge, low priority

**Task Status:**
- `not_started`: Initial state
- `in_progress`: User working on it
- `completed`: Finished

**Task Numbers:**
- Format: "1, 2, 3" or "1-5, 7"
- Parsed and stored individually
- Display as badges

### Styling Conventions

**Colors:**
- Use CSS variables: `hsl(var(--primary))`
- Don't hardcode hex colors
- Use semantic color names (primary, accent, destructive)

**Spacing:**
- Use Tailwind spacing scale (p-4, m-2, gap-3)
- Consistent padding in cards: p-6 on desktop, p-4 on mobile

**Typography:**
- Headings: font-semibold or font-bold
- Body: default font-weight
- Use text-sm, text-base, text-lg for sizing

**Components:**
- Always use shadcn-ui components when available
- Customize with className prop, not inline styles
- Use cn() utility for conditional classes

### Mobile-First Conventions

**Responsive Breakpoints:**
```
Default: Mobile (< 768px)
md: Tablet (≥ 768px)
lg: Desktop (≥ 1024px)
xl: Large desktop (≥ 1280px)
```

**iOS-Specific Handling:**
- Safe area insets: `pb-safe` or manual padding
- Keyboard overlap: adjust input position on focus
- Haptic feedback: use sparingly

**Touch Gestures:**
- Swipe detection for navigation
- Long press for context menus
- Pull to refresh (if implemented)

---

## Dependencies Management

### Adding New Dependencies

**Before adding:**
1. Check if existing library can handle the use case
2. Verify bundle size impact
3. Check for TypeScript support
4. Review maintenance status and popularity

**Installation:**
```bash
npm install package-name
npm install -D package-name  # Dev dependency
```

**Update after install:**
1. Check if types needed: `npm install -D @types/package-name`
2. Update relevant documentation
3. Test that build still works

### Key Dependency Notes

**Must-have:**
- `react`, `react-dom`: Core framework
- `react-router-dom`: Routing
- `@tanstack/react-query`: Server state
- `@supabase/supabase-js`: Backend
- `tailwindcss`: Styling

**Performance:**
- `@tanstack/react-virtual`: Virtual scrolling
- Keep math libraries lazy-loaded

**Development:**
- `vite`: Fast bundler
- `typescript`: Type safety
- `eslint`: Code quality

---

## Security Considerations

### Authentication
- Never store sensitive tokens in localStorage without encryption
- Use Supabase auth session management
- Always check user authentication before accessing protected resources
- Implement proper logout cleanup

### Database Security
- All tables must have RLS (Row Level Security) policies
- Never trust client-side data validation alone
- Use parameterized queries (Supabase handles this)
- Validate user ownership before operations

### File Uploads
- Validate file types before upload
- Set max file size limits
- Scan for malicious content (if applicable)
- Use private buckets for sensitive data

### API Keys
- Never commit `.env` file to git
- Use Vite's `VITE_` prefix for client-exposed variables
- Keep server-side keys separate and private
- Rotate keys periodically

---

## Deployment & Production

### Build Process

```bash
# Production build
npm run build

# Output in /dist folder
# Includes minified JS, CSS, and optimized assets
```

### Build Optimization

**Current optimizations:**
- Code splitting by route (14 lazy-loaded pages)
- Vendor chunk separation
- Math library separate chunk
- CSS minification
- Asset optimization

**Build output checks:**
- Chunk sizes shown in terminal
- Warning if chunk > 600 KB
- Review large chunks and optimize if needed

### Environment Variables

**Required for production:**
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

**Setting in production:**
- Use hosting platform's environment variable settings
- Never commit production keys to git
- Verify all VITE_ prefixed vars are set

### Deployment Checklist

- [ ] Run `npm run build` successfully
- [ ] Test production build with `npm run preview`
- [ ] Verify environment variables are set
- [ ] Check Supabase RLS policies are active
- [ ] Test authentication flow
- [ ] Verify mobile responsiveness
- [ ] Check console for errors
- [ ] Test all critical user flows
- [ ] Verify images and assets load
- [ ] Check Service Worker functionality

---

## Additional Resources

### Documentation Links

- **React**: https://react.dev/
- **TypeScript**: https://www.typescriptlang.org/docs/
- **Vite**: https://vitejs.dev/
- **React Router**: https://reactrouter.com/
- **TanStack Query**: https://tanstack.com/query/latest
- **Supabase**: https://supabase.com/docs
- **Tailwind CSS**: https://tailwindcss.com/docs
- **shadcn/ui**: https://ui.shadcn.com/
- **Framer Motion**: https://www.framer.com/motion/

### Supabase Dashboard

**URL**: https://vrsseotrfmsxpbciyqzc.supabase.co

**Key sections:**
- Table Editor: View/edit data
- SQL Editor: Run queries and migrations
- Authentication: Manage users
- Storage: Manage file buckets
- Database: View schema and policies
- Logs: Debug issues

### Project Links

- **Lovable Project**: https://lovable.dev/projects/5fbe4a32-1baf-47b0-8f47-83e3060cf929
- **Repository**: Check .git/config for remote URL

---

## Summary for AI Assistants

This is a **React + TypeScript + Vite** project with **Supabase** backend, focused on educational technology for Russian students preparing for ЕГЭ exams.

**Key points to remember:**
1. Use React Query for all data fetching
2. Mobile-first responsive design is critical
3. Performance matters: virtual scrolling, lazy loading, caching
4. Type safety: use TypeScript properly
5. Follow existing patterns: study similar components first
6. Test on mobile: this is a mobile-first app
7. Use shadcn-ui components: don't reinvent the wheel
8. Error handling: always use toast notifications
9. Security: RLS policies are essential
10. Git workflow: commit often, descriptive messages

**Before making changes:**
- Read relevant files
- Check existing patterns
- Understand the database schema
- Test thoroughly

**When stuck:**
- Check similar components for patterns
- Review type definitions
- Look at the database schema
- Check console for errors
- Review this CLAUDE.md guide

---

This comprehensive guide covers everything needed to work effectively on the Sokratai codebase. Use it as a reference for understanding architecture, making changes, and maintaining code quality.
