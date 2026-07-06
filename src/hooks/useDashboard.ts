import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/tauri-api";
import { useSettings } from "@/contexts/SettingsContext";

export function useDashboard() {
  const { settings } = useSettings();
  
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: api.getDashboard,
    refetchInterval: settings.autoRefresh ? settings.pollingInterval : false,
  });
}

export function useSystemStats() {
  const { settings } = useSettings();
  
  return useQuery({
    queryKey: ["system-stats"],
    queryFn: api.getSystemStats,
    refetchInterval: settings.autoRefresh ? 2000 : false, // Fixed 2s for smooth graphs
  });
}

export function useVmActions() {
  const queryClient = useQueryClient();

  const start = useMutation({ mutationFn: api.startVm, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }) });
  const stop = useMutation({ mutationFn: api.stopVm, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }) });
  const save = useMutation({ mutationFn: api.saveVm, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }) });
  const resume = useMutation({ mutationFn: api.resumeVm, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }) });
  const pause = useMutation({ mutationFn: api.pauseVm, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }) });
  const setMemory = useMutation({ 
    mutationFn: ({ name, memoryGb }: { name: string, memoryGb: number }) => api.setVmMemory(name, memoryGb),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] })
  });
  const setProcessors = useMutation({
    mutationFn: ({ name, processors }: { name: string, processors: number }) => api.setVmProcessors(name, processors),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] })
  });
  const connect = useMutation({ 
    mutationFn: ({ host, username }: { host: string, username?: string }) => api.connectVm(host, "RDP", username) 
  });
  const console = useMutation({ mutationFn: api.connectConsole });

  return { start, stop, save, resume, pause, setMemory, setProcessors, connect, console };
}

export function useHostActions() {
  const queryClient = useQueryClient();

  const addHost = useMutation({
    mutationFn: (data: { name: string, host: string, protocol: string, username?: string, tags?: string[] }) =>
      api.addRemoteHost(data.name, data.host, data.protocol, data.username, data.tags),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["dashboard"] });
      const prev = queryClient.getQueryData<any>(["dashboard"]);
      if (prev) {
        queryClient.setQueryData(["dashboard"], {
          ...prev,
          remote_hosts: [...prev.remote_hosts, { id: 'temp-'+Date.now(), ...data, is_detected: false, status: 'Active', is_hidden: false }]
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.prev) queryClient.setQueryData(["dashboard"], ctx.prev); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ["dashboard"] }); } 
  });
  
  const removeHost = useMutation({ 
    mutationFn: api.removeRemoteHost, 
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["dashboard"] });
      const prev = queryClient.getQueryData<any>(["dashboard"]);
      if (prev) {
        queryClient.setQueryData(["dashboard"], {
          ...prev,
          remote_hosts: prev.remote_hosts.filter((h: any) => h.id !== id)
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.prev) queryClient.setQueryData(["dashboard"], ctx.prev); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ["dashboard"] }); } 
  });

  const updateHost = useMutation({
    mutationFn: (data: { id: string, name: string, host: string, protocol: string, username?: string, tags?: string[] }) =>
      api.updateRemoteHost(data.id, data.name, data.host, data.protocol, data.username, data.tags),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["dashboard"] });
      const prev = queryClient.getQueryData<any>(["dashboard"]);
      if (prev) {
        queryClient.setQueryData(["dashboard"], {
          ...prev,
          remote_hosts: prev.remote_hosts.map((h: any) => h.id === data.id ? { ...h, ...data } : h)
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.prev) queryClient.setQueryData(["dashboard"], ctx.prev); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ["dashboard"] }); } 
  });
  const connect = useMutation({
    mutationFn: ({ host, protocol, username }: { host: string, protocol: string, username?: string }) =>
      api.connectVm(host, protocol, username)
  });

  return { addHost, removeHost, updateHost, connect };
}
