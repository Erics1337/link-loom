import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { LayoutDashboard, Link as LinkIcon, Settings, CreditCard, LogOut, Monitor } from 'lucide-react'
import Image from 'next/image'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    const supabase = createClient()

    const {
        data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
        redirect('/login')
    }

    // Get user premium status
    const { data: userRecord } = await supabase
        .from('users')
        .select('is_premium')
        .eq('id', session.user.id)
        .single()

    const isPremium = userRecord?.is_premium ?? false

    return (
        <div className="min-h-screen bg-gray-900 text-white flex">
            {/* Sidebar */}
            <aside className="w-64 bg-gray-950 border-r border-gray-800 flex flex-col fixed h-full z-10">
                <div className="p-6 flex items-center gap-2 font-bold text-xl tracking-tight border-b border-gray-800">
                    <div className="relative w-8 h-8">
                        <Image
                            src="/logo.png"
                            alt="Link Loom Logo"
                            fill
                            className="object-contain"
                        />
                    </div>
                    Link Loom
                </div>

                <nav className="flex-1 p-4 space-y-1">
                    <a href="/dashboard" className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                        <LayoutDashboard className="w-5 h-5" />
                        Dashboard
                    </a>
                    <a href="#" className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                        <LinkIcon className="w-5 h-5" />
                        My Links
                    </a>
                    <a href="/dashboard/devices" className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                        <Monitor className="w-5 h-5" />
                        Devices
                    </a>
                    <a href="#" className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                        <Settings className="w-5 h-5" />
                        Settings
                    </a>
                    <a href="/dashboard/billing" className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                        <CreditCard className="w-5 h-5" />
                        Billing
                    </a>
                </nav>

                <div className="p-4 border-t border-gray-800">
                    <div className="flex items-center gap-3 px-4 py-3 mb-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{session.user.email}</p>
                            <p className={`text-xs truncate ${isPremium ? 'text-green-400' : 'text-gray-500'}`}>{isPremium ? 'Pro Plan' : 'Free Plan'}</p>
                        </div>
                    </div>
                    <form action="/auth/signout" method="post">
                        <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                            <LogOut className="w-4 h-4" />
                            Sign Out
                        </button>
                    </form>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto ml-64">
                {children}
            </main>
        </div>
    )
}
