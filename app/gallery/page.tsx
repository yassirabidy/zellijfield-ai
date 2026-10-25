import { redirect } from 'next/navigation';

// The gallery lives in the Local dashboard.
export default function GalleryPage() {
  redirect('/local/gallery');
}
