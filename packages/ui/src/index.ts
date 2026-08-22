export { tokens, type Tokens } from './tokens.js';
export { cn } from './lib/utils.js';

// Components
export { Button, buttonVariants, type ButtonProps } from './components/button.js';
export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from './components/form.js';
export { Input, type InputProps } from './components/input.js';
export { Label } from './components/label.js';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card.js';
export { Badge, badgeVariants, type BadgeProps } from './components/badge.js';
export { Skeleton } from './components/skeleton.js';
export { Separator } from './components/separator.js';
export { Avatar, AvatarFallback, AvatarImage } from './components/avatar.js';

// Brand primitives — DentaBill-specific compositions on top of the shadcn primitives.
export { Pill, pillVariants, type PillProps } from './components/pill.js';
export { HeroDisplay, type HeroDisplayProps } from './components/hero-display.js';
export { SectionDisplay, type SectionDisplayProps } from './components/section-display.js';
export { ShadowCard, shadowCardVariants, type ShadowCardProps } from './components/shadow-card.js';
export { StatusDot, statusDotVariants, type StatusDotProps } from './components/status-dot.js';
export { BrandMark, type BrandMarkProps } from './components/brand-mark.js';
export {
  DashboardPageHeading,
  type DashboardPageHeadingProps,
} from './components/dashboard-page-heading.js';
export { StatTile, type StatTileProps } from './components/stat-tile.js';
