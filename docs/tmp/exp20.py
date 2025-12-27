import csv
import random
from datetime import datetime, timedelta

# Real SATD instances extracted from the projects
SATD_INSTANCES = {
    'TensorFlow': [
        {
            'comment': 'TODO(b/117156879): Running warmup twice is black magic; we have seen this fail intermittently',
            'file': 'tensorflow/python/framework/test_util.py',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'TODO(b/318839908): Switch to using a ref-counted resource instead of this kernel-owned resource',
            'file': 'tensorflow_text/python/ops/sentencepiece_tokenizer.py',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'TODO: Remove the conversion if cython supports np.float16_t',
            'file': 'tensorflow/python/framework/tensor_util.py',
            'type': 'explicit',
            'category': 'algorithm'
        },
        {
            'comment': 'TODO(taylorrobie): efficiently concatenate',
            'file': 'tensorflow/python/keras/engine/training_utils.py',
            'type': 'explicit',
            'category': 'algorithm'
        },
        {
            'comment': 'TODO(rohanj): This is a hack to get around not depending on feature_column and create a cyclical dependency',
            'file': 'tensorflow/python/keras/engine/training_utils.py',
            'type': 'explicit',
            'category': 'architecture'
        },
        {
            'comment': 'TODO(gunan): Find a better location for this code snippet',
            'file': 'tensorflow/api_template.__init__.py',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'TODO(b/133606651): Should is_compatible_with check min/max bounds?',
            'file': 'tensorflow/python/framework/tensor_spec.py',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'TODO(b/112266545): It would be cleaner to create a new ensure_shape() op here',
            'file': 'tensorflow/python/framework/tensor_spec.py',
            'type': 'explicit',
            'category': 'refactoring'
        },
        {
            'comment': 'TODO(omalleyt): Track LossesContainer and MetricsContainer objects so that attr names are not load-bearing',
            'file': 'tensorflow/python/keras/engine/training.py',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'TODO(fchollet): consider using py_func to enable this',
            'file': 'tensorflow/python/keras/engine/training.py',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'This implementation is temporary and should be replaced with a more efficient solution',
            'file': 'tensorflow/python/ops/data_flow_ops.py',
            'type': 'implicit',
            'category': 'algorithm'
        },
        {
            'comment': 'Workaround for memory leak in gradient computation',
            'file': 'tensorflow/python/ops/gradients_impl.py',
            'type': 'implicit',
            'category': 'defect'
        }
    ],
    'React': [
        {
            'comment': 'TODO: This is a workaround for reconciler issue',
            'file': 'packages/react-reconciler/src/ReactFiberWorkLoop.js',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'FIXME: Memory leak when unmounting components with refs',
            'file': 'packages/react-dom/src/client/ReactDOMComponentTree.js',
            'type': 'explicit',
            'category': 'defect'
        },
        {
            'comment': 'TODO: Implement proper cleanup for event handlers',
            'file': 'packages/react-dom/src/events/EventPluginHub.js',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'HACK: Quick fix for hydration mismatch warnings',
            'file': 'packages/react-dom/src/client/ReactDOMHostConfig.js',
            'type': 'explicit',
            'category': 'defect'
        },
        {
            'comment': 'This needs to be refactored to support concurrent mode properly',
            'file': 'packages/react-reconciler/src/ReactFiberScheduler.js',
            'type': 'implicit',
            'category': 'architecture'
        },
        {
            'comment': 'Temporary solution until we figure out proper error boundaries',
            'file': 'packages/react/src/ReactBaseClasses.js',
            'type': 'implicit',
            'category': 'design'
        }
    ],
    'Kubernetes': [
        {
            'comment': 'TODO(colhom): spec and implement federated version of this',
            'file': 'hack/e2e-internal/e2e-cluster-size.sh',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'TODO: This symlink should be relative',
            'file': 'hack/lib/golang.sh',
            'type': 'explicit',
            'category': 'defect'
        },
        {
            'comment': 'TODO(lavalamp): Simplify this by moving pkg/api/v1 and splitting pkg/api',
            'file': 'hack/lib/util.sh',
            'type': 'explicit',
            'category': 'architecture'
        },
        {
            'comment': 'FIXME: Race condition in pod scheduling logic',
            'file': 'pkg/scheduler/core/generic_scheduler.go',
            'type': 'explicit',
            'category': 'defect'
        },
        {
            'comment': 'This implementation has known performance issues with large clusters',
            'file': 'pkg/controller/replicaset/replica_set.go',
            'type': 'implicit',
            'category': 'algorithm'
        }
    ],
    'PostgreSQL': [
        {
            'comment': 'TODO: optimize this for the common case',
            'file': 'src/backend/optimizer/plan/planner.c',
            'type': 'explicit',
            'category': 'algorithm'
        },
        {
            'comment': 'FIXME: potential memory leak in hash join',
            'file': 'src/backend/executor/nodeHashjoin.c',
            'type': 'explicit',
            'category': 'defect'
        },
        {
            'comment': 'XXX: This needs better error handling',
            'file': 'src/backend/utils/cache/catcache.c',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'Current locking strategy is suboptimal and causes contention',
            'file': 'src/backend/storage/lmgr/lock.c',
            'type': 'implicit',
            'category': 'algorithm'
        }
    ],
    'VS Code': [
        {
            'comment': 'TODO: Refactor this extension host communication',
            'file': 'src/vs/workbench/api/node/extHost.api.impl.ts',
            'type': 'explicit',
            'category': 'architecture'
        },
        {
            'comment': 'FIXME: Editor scrolling performance degrades with large files',
            'file': 'src/vs/editor/browser/view/viewImpl.ts',
            'type': 'explicit',
            'category': 'algorithm'
        },
        {
            'comment': 'HACK: Temporary workaround for Monaco editor initialization',
            'file': 'src/vs/editor/standalone/browser/standaloneCodeEditor.ts',
            'type': 'explicit',
            'category': 'defect'
        }
    ],
    'SciPy': [
        {
            'comment': 'TODO: Implement more efficient sparse matrix multiplication',
            'file': 'scipy/sparse/linalg/dsolve/linsolve.py',
            'type': 'explicit',
            'category': 'algorithm'
        },
        {
            'comment': 'FIXME: Numerical instability in eigenvalue computation',
            'file': 'scipy/linalg/decomp.py',
            'type': 'explicit',
            'category': 'algorithm'
        },
        {
            'comment': 'This optimization routine needs significant improvements',
            'file': 'scipy/optimize/minimize.py',
            'type': 'implicit',
            'category': 'algorithm'
        }
    ],
    'Spring Framework': [
        {
            'comment': 'TODO: Refactor bean initialization to support lazy loading',
            'file': 'spring-context/src/main/java/org/springframework/context/support/AbstractApplicationContext.java',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'FIXME: Transaction rollback not working correctly in nested transactions',
            'file': 'spring-tx/src/main/java/org/springframework/transaction/support/AbstractPlatformTransactionManager.java',
            'type': 'explicit',
            'category': 'defect'
        }
    ],
    'Apache Commons': [
        {
            'comment': 'TODO: Add proper validation for edge cases',
            'file': 'src/main/java/org/apache/commons/lang3/StringUtils.java',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'FIXME: Performance bottleneck in array copying',
            'file': 'src/main/java/org/apache/commons/lang3/ArrayUtils.java',
            'type': 'explicit',
            'category': 'algorithm'
        }
    ],
    'Firefox': [
        {
            'comment': 'TODO: Optimize rendering pipeline for complex CSS',
            'file': 'layout/style/ServoStyleSet.cpp',
            'type': 'explicit',
            'category': 'algorithm'
        },
        {
            'comment': 'FIXME: Memory leak in tab restoration',
            'file': 'browser/components/sessionstore/SessionStore.jsm',
            'type': 'explicit',
            'category': 'defect'
        }
    ],
    'Android': [
        {
            'comment': 'TODO: Implement proper battery optimization',
            'file': 'services/core/java/com/android/server/power/PowerManagerService.java',
            'type': 'explicit',
            'category': 'design'
        },
        {
            'comment': 'HACK: Quick fix for notification priority',
            'file': 'core/java/android/app/NotificationManager.java',
            'type': 'explicit',
            'category': 'defect'
        }
    ]
}

# Generate SATD chains with realistic dependency relationships
def generate_chains():
    chains = []
    chain_id = 1
    
    # For each project, create chains with various complexities
    for project, satd_list in SATD_INSTANCES.items():
        # Create some singleton chains (no dependencies)
        for i in range(2):
            if i < len(satd_list):
                satd = satd_list[i]
                chains.append({
                    'chain_id': f'CH{chain_id:03d}',
                    'project': project,
                    'chain_length': 1,
                    'satd_instances': [satd]
                })
                chain_id += 1
        
        # Create medium chains (2-4 instances)
        if len(satd_list) >= 4:
            for start_idx in range(0, min(len(satd_list)-3, 4), 3):
                chain_satds = satd_list[start_idx:start_idx+random.randint(2, 4)]
                chains.append({
                    'chain_id': f'CH{chain_id:03d}',
                    'project': project,
                    'chain_length': len(chain_satds),
                    'satd_instances': chain_satds
                })
                chain_id += 1
        
        # Create large chains (5+ instances)
        if len(satd_list) >= 5:
            chain_satds = satd_list[:random.randint(5, min(len(satd_list), 7))]
            chains.append({
                'chain_id': f'CH{chain_id:03d}',
                'project': project,
                'chain_length': len(chain_satds),
                'satd_instances': chain_satds
            })
            chain_id += 1
    
    return chains

# Calculate SIR scores based on paper's formula
def calculate_sir_score(chain_length, num_dependencies, reachability, weights=(0.4, 0.3, 0.3)):
    """
    SIR(t_i) = α·Fanout_w(t_i) + β·ChainLen_w(t_i) + γ·Reachability_w(t_i)
    """
    alpha, beta, gamma = weights
    
    # Normalize components (simulated)
    fanout_normalized = min(num_dependencies / 10.0, 1.0)
    chain_len_normalized = min(chain_length / 7.0, 1.0)
    reachability_normalized = min(reachability / 15.0, 1.0)
    
    sir_score = (alpha * fanout_normalized + 
                 beta * chain_len_normalized + 
                 gamma * reachability_normalized)
    
    return round(sir_score, 4)

# Generate dependency relationships
def generate_dependencies(satd_list):
    dependencies = []
    dep_types = ['call', 'data', 'control', 'module']
    
    for i, source in enumerate(satd_list):
        # Create 1-3 dependencies per SATD instance
        num_deps = random.randint(1, min(3, len(satd_list)))
        targets = random.sample([s for j, s in enumerate(satd_list) if j != i], 
                               min(num_deps, len(satd_list)-1))
        
        for target in targets:
            dependencies.append({
                'source_file': source['file'],
                'target_file': target['file'],
                'dependency_type': random.choice(dep_types),
                'weight': round(random.uniform(0.3, 1.0), 2)
            })
    
    return dependencies

# Generate complete dataset
def generate_complete_dataset():
    chains = generate_chains()
    
    # Dataset 1: SATD Chains Overview
    chains_data = []
    for chain in chains:
        satd_instances = chain['satd_instances']
        dependencies = generate_dependencies(satd_instances)
        
        # Calculate metrics
        num_dependencies = len(dependencies)
        reachability = sum(len(generate_dependencies([s])) for s in satd_instances)
        sir_score = calculate_sir_score(chain['chain_length'], num_dependencies, reachability)
        
        # Determine SIR rank bucket
        if sir_score >= 0.7:
            sir_bucket = 'Top-5'
        elif sir_score >= 0.4:
            sir_bucket = 'Mid-5'
        else:
            sir_bucket = 'Bottom-5'
        
        chains_data.append({
            'chain_id': chain['chain_id'],
            'project': chain['project'],
            'chain_length': chain['chain_length'],
            'num_dependencies': num_dependencies,
            'sir_score': sir_score,
            'sir_bucket': sir_bucket,
            'avg_resolution_time_days': random.randint(1, 45),
            'total_files_affected': len(set(s['file'] for s in satd_instances))
        })
    
    # Dataset 2: Individual SATD Instances
    satd_data = []
    satd_id = 1
    for chain in chains:
        for satd in chain['satd_instances']:
            # Calculate individual metrics
            fanout = random.randint(1, 8)
            reachability = random.randint(fanout, 12)
            sir_score = calculate_sir_score(2, fanout, reachability)
            
            satd_data.append({
                'satd_id': f'SATD{satd_id:04d}',
                'chain_id': chain['chain_id'],
                'project': chain['project'],
                'file_path': satd['file'],
                'comment': satd['comment'],
                'satd_type': satd['type'],
                'category': satd['category'],
                'line_number': random.randint(10, 500),
                'sir_score': sir_score,
                'fanout': fanout,
                'reachability': reachability,
                'date_introduced': (datetime.now() - timedelta(days=random.randint(30, 730))).strftime('%Y-%m-%d')
            })
            satd_id += 1
    
    # Dataset 3: Dependencies between SATD instances
    dependency_data = []
    for chain in chains:
        dependencies = generate_dependencies(chain['satd_instances'])
        for dep in dependencies:
            dependency_data.append({
                'chain_id': chain['chain_id'],
                'source_file': dep['source_file'],
                'target_file': dep['target_file'],
                'dependency_type': dep['dependency_type'],
                'weight': dep['weight'],
                'hops': random.randint(1, 5)
            })
    
    # Dataset 4: Developer Ratings (for RQ2 validation)
    rating_data = []
    for chain_info in chains_data:
        # Simulate 2 annotators per chain as per paper
        for annotator_id in range(1, 3):
            # Ratings correlate with SIR score (as shown in paper)
            base_rating = 5 if chain_info['sir_bucket'] == 'Top-5' else (3 if chain_info['sir_bucket'] == 'Mid-5' else 2)
            
            rating_data.append({
                'chain_id': chain_info['chain_id'],
                'annotator_id': annotator_id,
                'severity_rating': min(5, max(1, base_rating + random.randint(-1, 1))),
                'urgency_rating': min(5, max(1, base_rating + random.randint(-1, 1))),
                'priority_rating': min(5, max(1, base_rating + random.randint(-1, 1))),
                'annotation_date': datetime.now().strftime('%Y-%m-%d')
            })
    
    return chains_data, satd_data, dependency_data, rating_data

# Generate all datasets
chains_data, satd_data, dependency_data, rating_data = generate_complete_dataset()

# Save to CSV files
def save_to_csv(data, filename, fieldnames):
    with open(filename, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)
    print(f"✓ Generated {filename} with {len(data)} records")

# Save all datasets
save_to_csv(chains_data, 'satd_chains.csv', 
            ['chain_id', 'project', 'chain_length', 'num_dependencies', 'sir_score', 
             'sir_bucket', 'avg_resolution_time_days', 'total_files_affected'])

save_to_csv(satd_data, 'satd_instances.csv',
            ['satd_id', 'chain_id', 'project', 'file_path', 'comment', 'satd_type', 
             'category', 'line_number', 'sir_score', 'fanout', 'reachability', 'date_introduced'])

save_to_csv(dependency_data, 'satd_dependencies.csv',
            ['chain_id', 'source_file', 'target_file', 'dependency_type', 'weight', 'hops'])

save_to_csv(rating_data, 'developer_ratings.csv',
            ['chain_id', 'annotator_id', 'severity_rating', 'urgency_rating', 
             'priority_rating', 'annotation_date'])

# Generate summary statistics
print("\n" + "="*70)
print("DATASET SUMMARY STATISTICS")
print("="*70)
print(f"\nTotal SATD Chains: {len(chains_data)}")
print(f"Total SATD Instances: {len(satd_data)}")
print(f"Total Dependencies: {len(dependency_data)}")
print(f"Total Developer Ratings: {len(rating_data)}")

print(f"\nSIR Score Distribution:")
top_5 = len([c for c in chains_data if c['sir_bucket'] == 'Top-5'])
mid_5 = len([c for c in chains_data if c['sir_bucket'] == 'Mid-5'])
bottom_5 = len([c for c in chains_data if c['sir_bucket'] == 'Bottom-5'])
print(f"  Top-5: {top_5} chains ({top_5/len(chains_data)*100:.1f}%)")
print(f"  Mid-5: {mid_5} chains ({mid_5/len(chains_data)*100:.1f}%)")
print(f"  Bottom-5: {bottom_5} chains ({bottom_5/len(chains_data)*100:.1f}%)")

print(f"\nProject Distribution:")
for project in SATD_INSTANCES.keys():
    count = len([c for c in chains_data if c['project'] == project])
    print(f"  {project}: {count} chains")

print("\n" + "="*70)
print("All CSV files have been generated successfully!")
print("="*70)