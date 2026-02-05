# GRP Water Tank Quotation Kanban System

A modern, feature-rich Kanban board application for managing GRP water tank quotations with advanced filtering, remarks management, and role-based access control.

## Features

### Authentication
- Simple admin/user role selection
- Admin: Full access to add, edit, and delete cards
- User: View cards and add remarks (cannot edit)

### Kanban Board
- **4 Lists**: Quotation, Submittal, Review, LPO
- **View Modes**: Kanban, Table (coming soon), Gantt (coming soon)
- **Card Display**: Shows Quote No, Date, Sales Person, Subject, Project Location
- **Color Coding**: Cards colored based on latest remark status
  - Red (light): Active
  - Yellow (light): Pending
  - Blue (light): Inactive

### Card Management
- **Admin Only**: Add, edit, and delete cards
- **Card Details Modal**: Click any card to view full details
- **Drag & Drop**: Move cards between lists (admin only)

### Remarks System
- **Multi-List Remarks**: Add remarks to multiple lists at once using checkboxes
- **Remark Types**: Active, Pending, Inactive
- **Tags**: Categorize remarks with custom tags
- **Edit Permissions**:
  - Admin: Can edit all remarks
  - User: Can add remarks but cannot edit once submitted
- **List-Specific Display**: Remarks shown per list in card modal
- **All Remarks View**: See all remarks across all lists when viewing a card

### Filtering
- **Date Filters**: Filter by day, week, month, or all time
- **Status Filters**: Filter by Active, Pending, Inactive per list
- **Quote Number Search**: Quick search by quote number
- **Card Count**: Dynamic card count adjusted with filters

### Design
- **Poppins Font**: Professional, modern typography
- **Responsive Layout**: Works on all screen sizes
- **Attractive UI**: Clean, modern design matching the reference image
- **Smooth Animations**: Hover effects and transitions

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

### Build

```bash
npm run build
```

### Production

```bash
npm start
```

## Usage

1. **Login**: Select Admin or User role on the login page
2. **View Kanban Board**: See all cards organized in 4 lists
3. **Add Card** (Admin only): Click "Add Card" button in any list
4. **View Card Details**: Click on any card to open the modal
5. **Add Remarks**: In the card modal, click "Add Remark" and select which lists to add to
6. **Filter Cards**: Use the filter buttons in list headers or the global date filter
7. **Search**: Use the search bars to find specific cards or tasks

## Data Storage

Currently, data is stored in JSON files within the codebase:
- `/data/kanban-data.json`: Main kanban board data with cards and remarks
- `/data/sample_quotations.json`: Sample quotation data (reference)

## Technology Stack

- **Framework**: Next.js 14
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Date Handling**: date-fns

## Project Structure

```
├── components/
│   ├── KanbanBoard.tsx      # Main board component
│   ├── KanbanList.tsx       # List column component
│   ├── KanbanCard.tsx       # Card component
│   └── CardModal.tsx        # Card details modal
├── pages/
│   ├── index.tsx            # Login page
│   ├── kanban.tsx           # Main Kanban page
│   └── _app.tsx             # App wrapper
├── types/
│   └── index.ts             # TypeScript types
├── data/
│   ├── kanban-data.json     # Kanban data
│   └── sample_quotations.json # Sample data
└── styles/
    └── globals.css          # Global styles
```

## Key Features Implementation

### Remark System
- Remarks are list-specific but stored per card
- Color coding updates automatically based on latest remark
- Checkbox system allows adding to multiple lists simultaneously
- Admin can edit/delete any remark; users cannot edit after submission

### Filter System
- List-level filters for remark status
- Global date range filter
- Quote number search
- Dynamic card counts

### Role-Based Access
- Admin: Full CRUD operations
- User: View and add remarks only
- Stored in localStorage (for demo purposes)

## Future Enhancements
- Table view implementation
- Gantt chart view implementation
- Backend API integration
- Real-time collaboration
- Export/Import functionality
- Advanced analytics dashboard
