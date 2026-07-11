import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface Branch {
  id: string;
  name: string;
  is_warehouse: boolean;
  location: string | null;
  status?: string;
  parent_id?: string | null;
}

export interface OrganizedBranch extends Branch {
  isSubStore?: boolean;
  parentName?: string;
}

/**
 * Organizes a list of branches into a hierarchical list (parent followed by its sub-stores).
 */
export function getOrganizedBranches(branches: Branch[]): OrganizedBranch[] {
  const parents = branches.filter(b => !b.parent_id);
  const subStores = branches.filter(b => b.parent_id);
  
  const result: OrganizedBranch[] = [];
  
  // Sort parents alphabetically by name
  parents.sort((a, b) => a.name.localeCompare(b.name));
  
  for (const parent of parents) {
    result.push(parent);
    // Find children of this parent and sort them alphabetically
    const children = subStores.filter(c => c.parent_id === parent.id);
    children.sort((a, b) => a.name.localeCompare(b.name));
    
    for (const child of children) {
      result.push({
        ...child,
        isSubStore: true,
        parentName: parent.name
      });
    }
  }
  
  // Append any orphaned sub-stores
  for (const child of subStores) {
    if (!parents.some(p => p.id === child.parent_id)) {
      result.push({
        ...child,
        isSubStore: true,
        parentName: 'Unknown'
      });
    }
  }
  
  return result;
}

