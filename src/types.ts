export type ToolMode = 'select' | 'build_line' | 'create_obj' | 'cut_line' | 'edit_obj' | 'joint';

export type PlacementState = { 
    type: 'static' | 'dynamic', 
    shape: 'circle' | 'box' | 'rounded_box' | 'capsule' | 'vesica' 
} | null;
